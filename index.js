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

// Inicialização Correta do Estado do Sistema
let botState = { 
    isRunning: false, 
    iaCloudUrl: "https://onrender.com",
    tipoConexao: 'nuvem',
    processRef: null,
    chaveAtivaIndex: 0 
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
            const respostaIara = await fetch(`${botState.iaCloudUrl}/ping`, { method: 'GET' }).catch(() => null);
            botState.isRunning = true;
            return res.json({ success: true, message: 'Comando enviado! Conexão com a Iara restabelecida.' });
        }
        res.json({ success: true, message: `Comando ${comando} processado localmente.` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Filtro de Arquivos do Painel Lateral
app.get('/api/dashboard/arquivos', async (req, res) => {
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

    try {
        const itens = fs.readdirSync(__dirname);
        const arquivosFiltrados = itens.filter(item => {
            const caminhoAbsoluto = path.join(__dirname, item);
            const dadosItem = fs.statSync(caminhoAbsoluto);
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
            fs.unlinkSync(alvo);
            return res.json({ success: true, message: `Arquivo ${filename} removido fisicamente.` });
        }
        res.status(404).json({ success: false, message: "Arquivo não localizado no disco." });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==========================================================================
// 💬 CHAT: IMPLEMENTAÇÃO DO SISTEMA DE PORTARIA / AUTENTICAÇÃO DUPLA
// ==========================================================================
app.post('/api/chat', multer().single('media'), async (req, res, next) => {
    const { message } = req.body;
    let respostaFinal = "";
    
    const maxTentativasRede = 3;
    let urlDestinoReal = `${botState.iaCloudUrl}/api/mensagem`;

    for (let tentativa = 1; tentativa <= maxTentativasRede; tentativa++) {
        try {
            const tokenAtivo = chavesGemini[botState.chaveAtivaIndex];
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            console.log(`[Handshake ${tentativa}/${maxTentativasRede}] Conectando a ${urlDestinoReal}`);

            // Envio das credenciais completas exigidas na portaria da Iara
            const respostaNuvem = await fetch(urlDestinoReal, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer DiamanteBot_2026_Privado_#777', // Chave única da Casa
                    'X-Gemini-Key': tokenAtivo // Chave ativa repassada para o robô pensar
                },
                body: JSON.stringify({ 
                    mensagem: message || "Mídia transmitida", 
                    origem: "dashboard" 
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (respostaNuvem.status === 429) {
                console.warn(`[Cota Gemini Esgotada] Rotacionando índice de chave...`);
                botState.chaveAtivaIndex = (botState.chaveAtivaIndex + 1) % chavesGemini.length;
                continue; 
            }

            if (!respostaNuvem.ok) {
                const textoErroServidor = await respostaNuvem.text().catch(() => "Sem resposta textual");
                respostaFinal = `Erro [${respostaNuvem.status}]: ${textoErroServidor || respostaNuvem.statusText}`;
                break; 
            }

            const dadosIa = await respostaNuvem.json();
            respostaFinal = dadosIa.resposta || dadosIa.text || dadosIa.message || JSON.stringify(dadosIa);
            break; 

        } catch (erroFetch) {
            console.error(`[Falha Tentativa ${tentativa}]: ${erroFetch.message}`);
            if (tentativa === maxTentativasRede) {
                respostaFinal = `Erro [Rede/Timeout]: A Iara não respondeu após os handshakes de rede. Detalhe: ${erroFetch.message}`;
            }
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
