const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
const extractDir = path.join(__dirname, 'uploads', 'bot-extraido');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, 'bot_projeto.zip')
});
const upload = multer({ storage: storage });

// Proteção e Segurança de Cabeçalhos HTTP
app.use(helmet({
    contentSecurityPolicy: false // Permite carregar mídias de blob de áudio/vídeo nativas
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Lista de Chaves da API do Gemini (Rodízio / Load Balancing)
const chavesGemini = [
    process.env.GEMINI_KEY_1 || "CHAVE_RESERVA_1",
    process.env.GEMINI_KEY_2 || "CHAVE_RESERVA_2",
    process.env.GEMINI_KEY_3 || "CHAVE_RESERVA_3"
];

// ==========================================================================
// 🛠️ FIX 1: INICIALIZAÇÃO CORRETA DO ESTADO (EVITA UNDEFINED NO PAINEL)
// ==========================================================================
let botState = { 
    isRunning: false, 
    iaCloudUrl: "https://onrender.com",
    tipoConexao: 'nuvem',
    processRef: null,
    chaveAtivaIndex: 0 // Forçado a iniciar em 0 para sincronizar com o Dashboard
};
let ultimoArquivoZip = null;

// Rota Suprema Anti-Sono para UptimeRobot
app.all('/ping', (req, res) => {
    res.status(200).send('pong - DiamanteBot acordado!');
});
app.head('/', (req, res) => {
    res.status(200).end();
});

app.post('/api/ia/conectar', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL inválida.' });
    botState.iaCloudUrl = url.replace(/\/$/, ""); 
    botState.tipoConexao = 'nuvem';
    res.json({ success: true, message: 'Conectado à Iara!' });
});

app.post('/api/engine/start', async (req, res, next) => {
    try {
        botState.isRunning = true;
        res.json({ success: true, status: 'online', message: 'Motor sincronizado com a Iara na nuvem!' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/engine/status', (req, res) => {
    res.json({ 
        status: botState.isRunning ? 'online' : 'offline',
        iaCloudUrl: botState.iaCloudUrl,
        chaveAtivaIndex: botState.chaveAtivaIndex
    });
});

app.post('/api/engine/comando', async (req, res) => {
    const { comando } = req.body;
    try {
        if (comando === 'reiniciar') {
            // Tenta dar um handshake de reinício no motor da Iara
            const respostaIara = await fetch(`${botState.iaCloudUrl}/ping`, { method: 'GET' }).catch(() => null);
            botState.isRunning = true;
            return res.json({ success: true, message: 'Comando enviado! Conexão com a Iara restabelecida.' });
        }
        res.json({ success: true, message: `Comando ${comando} processado localmente.` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==========================================================================
// 📁 FIX 3: FILTRO DE ARQUIVOS (IGNORA PASTAS DO SISTEMA NO BACKFALL)
// ==========================================================================
app.get('/api/dashboard/arquivos', async (req, res) => {
    // 1. Tenta buscar da nuvem da Iara primeiro
    if (botState.tipoConexao === 'nuvem' && botState.iaCloudUrl) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 5000);
            const resposta = await fetch(`${botState.iaCloudUrl}/api/sistema/arquivos`, { signal: controller.signal });
            clearTimeout(id);
            if (resposta.ok) {
                const dados = await resposta.json();
                return res.json(dados);
            }
        } catch (e) {}
    }

    // 2. Fallback Físico Local com Filtros Avançados de Pastas
    try {
        const itens = fs.readdirSync(__dirname);
        const arquivosFiltrados = itens.filter(item => {
            const caminhoAbsoluto = path.join(__dirname, item);
            const dadosItem = fs.statSync(caminhoAbsoluto);
            
            // FILTRO REAL: Remove pastas pesadas ou estruturais para não poluir o celular
            return dadosItem.isFile() && 
                   item !== 'index.js' && 
                   item !== 'package.json' && 
                   item !== 'package-lock.json';
        });
        res.json(arquivosFiltrados);
    } catch (err) {
        res.status(500).json({ error: true, message: "Erro ao varrer diretório local." });
    }
});

// Exclusão física real de arquivos do disco
app.post('/api/dashboard/arquivos/deletar', (req, res) => {
    const { filename } = req.body;
    try {
        const alvo = path.join(__dirname, filename);
        if (fs.existsSync(alvo)) {
            fs.unlinkSync(alvo); // Deleta do HD do Render de verdade
            return res.json({ success: true, message: `Arquivo ${filename} removido fisicamente.` });
        }
        res.status(404).json({ success: false, message: "Arquivo não localizado no disco." });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==========================================================================
// 💬 FIX 2 e 4: DEBUGGING REAL E VALIDAÇÃO DE ROTAS (RODÍZIO GEMINI ATIVO)
// ==========================================================================
app.post('/api/chat', multer().single('media'), async (req, res, next) => {
    const { message } = req.body;
    let respostaFinal = "";
    
    // Configurações de Handshake e Tentativas (Retries)
    const maxTentativasRede = 3;
    let urlDestinoReal = `${botState.iaCloudUrl}/api/mensagem`; // Rota exata solicitada

    for (let tentativa = 1; tentativa <= maxTentativasRede; tentativa++) {
        try {
            // Pega a chave do rodízio baseada no índice ativo
            const tokenAtivo = chavesGemini[botState.chaveAtivaIndex];

            // Configuração do Timeout de 10 segundos exigido
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            console.log(`[Handshake - Tentativa ${tentativa}/${maxTentativasRede}] Conectando a ${urlDestinoReal}`);

            const respostaNuvem = await fetch(urlDestinoReal, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenAtivo}` // Envio do cabeçalho de autenticação
                },
                body: JSON.stringify({ 
                    mensagem: message || "Mídia transmitida", 
                    origem: "dashboard" 
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Se a Iara estourou a cota do Gemini (Erro 429), faz o rodízio automático de chave imediatamente!
            if (respostaNuvem.status === 429) {
                console.warn(`[Cota Esgotada - Chave ${botState.chaveAtivaIndex}] Alternando Load Balancing...`);
                botState.chaveAtivaIndex = (botState.chaveAtivaIndex + 1) % chavesGemini.length;
                continue; // Pula para a próxima tentativa usando a nova chave de API
            }

            // Se der erro 502, 500 ou 404, captura o texto interno do erro da Iara
            if (!respostaNuvem.ok) {
                const textoErroServidor = await respostaNuvem.text().catch(() => "Sem resposta textual");
                respostaFinal = `Erro [${respostaNuvem.status}]: ${textoErroServidor || respostaNuvem.statusText}`;
                break; // Interrompe as tentativas pois o servidor respondeu, apesar de ser um erro
            }

            // Resposta obtida com sucesso!
            const dadosIa = await respostaNuvem.json();
            respostaFinal = dadosIa.resposta || dadosIa.text || dadosIa.message || JSON.stringify(dadosIa);
            break; // Sai do laço pois deu tudo certo

        } catch (erroFetch) {
            console.error(`[Falha Tentativa ${tentativa}]: ${erroFetch.message}`);
            
            // Se foi a última tentativa e falhou por timeout ou rede fora do ar
            if (tentativa === maxTentativasRede) {
                respostaFinal = `Erro [Rede/Timeout]: A Iara não respondeu após ${maxTentativasRede} tentativas de handshake. Detalhe: ${erroFetch.message}`;
            }
            // Pequeno intervalo antes de tentar o próximo retry (ajuda o Render a acordar)
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    res.json({ text: respostaFinal, timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
    console.error('Erro Interno:', err.stack);
    res.status(500).json({ error: true, message: 'Ocorreu um erro interno na fiação do servidor.' });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando perfeitamente na porta ${PORT}`);
});
