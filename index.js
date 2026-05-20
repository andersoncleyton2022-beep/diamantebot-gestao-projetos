const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const AdmZip = require('adm-zip');
const helmet = require('helmet');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
const extractDir = path.join(__dirname, 'uploads', 'bot-extraido');

// Verificação e criação de diretórios com permissão de escrita real
try {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
    fs.accessSync(uploadDir, fs.constants.W_OK);
    fs.accessSync(extractDir, fs.constants.W_OK);
} catch (err) {
    console.error("⚠️ ERRO CRÍTICO DE PERMISSÃO DE ESCRITA:", err.message);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, 'bot_projeto.zip')
});
const upload = multer({ storage: storage });

// SEGURANÇA E MIDDLEWARES
app.use(helmet({
    contentSecurityPolicy: false, // Permite carregar recursos externos (como avatares e links da nuvem) sem bloqueio no dashboard
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// LÓGICA DE RODÍZIO DE CHAVES DO GEMINI (PRODUÇÃO REAL)
// Define as chaves pegas do Environment do Render. Caso não existam, usa fallbacks configurados.
const geminiKeys = [
    process.env.GEMINI_KEY_1 || "CHAVE_RESERVA_1",
    process.env.GEMINI_KEY_2 || "CHAVE_RESERVA_2",
    process.env.GEMINI_KEY_3 || "CHAVE_RESERVA_3"
];
let currentKeyIndex = 0;

function obterProximaChaveGemini() {
    currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;
    console.log(`🔄 Limite atingido! Alternando automaticamente para a Chave Gemini ${currentKeyIndex + 1}`);
    return geminiKeys[currentKeyIndex];
}

let botState = { 
    isRunning: false, 
    iaCloudUrl: "https://onrender.com",
    tipoConexao: 'nuvem',
    processRef: null
};
let ultimoArquivoZip = null;

app.all('/ping', (req, res) => {
    res.status(200).send('pong - DiamanteBot ativo e acordado!');
});

app.head('/', (req, res) => {
    res.status(200).end();
});

// Handshake de Validação em tempo real solicitado
app.post('/api/ia/handshake', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL em branco.' });
    
    const targetUrl = url.replace(/\/$/, "");
    try {
        // Envia uma requisição rápida de teste (Timeout de 5 segundos para o Handshake)
        const resposta = await fetch(`${targetUrl}/ping`, { signal: AbortSignal.timeout(5000) });
        if (resposta.ok || resposta.status === 404) { 
            return res.json({ success: true, url: targetUrl });
        }
        res.status(502).json({ success: false, status: resposta.status, message: 'Servidor respondeu com código de erro.' });
    } catch (err) {
        res.status(504).json({ success: false, message: 'Inacessível ou em modo sono.', detalhe: err.message });
    }
});

app.post('/api/ia/conectar', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL inválida.' });
    botState.iaCloudUrl = url.replace(/\/$/, ""); 
    botState.tipoConexao = 'nuvem';
    res.json({ success: true, message: 'Link sincronizado no Dashboard!' });
});

app.post('/api/engine/start', async (req, res, next) => {
    try {
        if (botState.tipoConexao === 'local') {
            if (!ultimoArquivoZip || !fs.existsSync(ultimoArquivoZip)) {
                return res.status(400).json({ error: 'Envie o arquivo .zip primeiro.' });
            }
            const zip = new AdmZip(ultimoArquivoZip);
            zip.extractAllTo(extractDir, true);
            exec('npm install', { cwd: extractDir }, (error) => {
                let mainFile = 'index.js';
                if (!fs.existsSync(path.join(extractDir, 'index.js'))) {
                    if (fs.existsSync(path.join(extractDir, 'bot.js'))) mainFile = 'bot.js';
                }
                botState.processRef = exec(`node ${mainFile}`, { cwd: extractDir });
                botState.isRunning = true;
            });
            return res.json({ success: true, status: 'online', message: 'Motor local ligado!' });
        } 
        botState.isRunning = true;
        res.json({ success: true, status: 'online', message: 'Dashboard sincronizado com o Motor Nuvem!' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/engine/status', (req, res) => {
    res.json({ status: botState.isRunning ? 'online' : 'offline' });
});

// EXCLUSÃO FÍSICA REAL DO ARQUIVO SOLICITADA
app.post('/api/dashboard/arquivos/deletar', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ success: false, message: 'Nome do arquivo não enviado.' });
    
    // Caminho real do arquivo dentro da pasta de extração ou uploads
    const caminhoRealUpload = path.join(uploadDir, filename);
    const caminhoRealExtraido = path.join(extractDir, filename);

    try {
        let deletado = false;
        if (fs.existsSync(caminhoRealUpload)) {
            fs.unlinkSync(caminhoRealUpload);
            deletado = true;
        }
        if (fs.existsSync(caminhoRealExtraido)) {
            fs.unlinkSync(caminhoRealExtraido);
            deletado = true;
        }

        if (deletado) {
            return res.json({ success: true, message: `Arquivo ${filename} removido fisicamente do servidor.` });
        }
        res.status(404).json({ success: false, message: 'Arquivo não encontrado nas pastas físicas do servidor.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Falha física de exclusão.', erro: err.message });
    }
});

app.get('/api/dashboard/arquivos', async (req, res) => {
    if (!botState.iaCloudUrl || !botState.iaCloudUrl.startsWith('http')) return res.json([]);
    try {
        const respostaMotor = await fetch(`${botState.iaCloudUrl}/api/sistema/arquivos`, { signal: AbortSignal.timeout(8000) });
        if (!respostaMotor.ok) throw new Error();
        const dadosArquivos = await respostaMotor.json();
        res.json(dadosArquivos);
    } catch (error) {
        // Fallback físico real: Lista os arquivos reais locais gerados por uploads/extrações
        try {
            const locaisUpload = fs.readdirSync(uploadDir);
            const locaisExtraido = fs.readdirSync(extractDir).filter(f => f !== 'node_modules');
            res.json([...new Set([...locaisUpload, ...locaisExtraido])]);
        } catch (e) {
            res.json([]);
        }
    }
});

// CHAT COM TIMEOUT E LOG DE ROTAS INTEGRADO
app.post('/api/chat', multer().single('media'), async (req, res, next) => {
    try {
        const { message } = req.body;
        let respostaTexto = "";

        if (botState.tipoConexao === 'nuvem' && botState.iaCloudUrl && botState.iaCloudUrl.startsWith('http')) {
            const rotasPossiveis = [
                `${botState.iaCloudUrl}/api/mensagem`,
                `${botState.iaCloudUrl}/mensagem`,
                `${botState.iaCloudUrl}/`
            ];

            let logTentativas = [];
            let sucesso = false;

            for (const urlTeste of rotasPossiveis) {
                // MECANISMO DE RETRY INTELIGENTE (TENTA ATÉ 2 VEZES POR ROTA CASO O RENDER ESTEJA ACORDANDO)
                for (let tentativa = 1; tentativa <= 2; tentativa++) {
                    try {
                        let chaveAtual = geminiKeys[currentKeyIndex];
                        
                        // TIMEOUT OBRIGATÓRIO DE 10 SEGUNDOS INSTALADO NO FETCH
                        const respostaNuvem = await fetch(urlTeste, {
                            method: 'POST',
                            headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${chaveAtual}` // Envia a chave ativa no rodízio
                            },
                            body: JSON.stringify({ mensagem: message || "Arquivo de mídia", origem: "dashboard" }),
                            signal: AbortSignal.timeout(10000)
                        });

                        // Se estourar a cota da API do Gemini (Erro 429) -> Faz o rodízio na hora e força o Retry
                        if (respostaNuvem.status === 429) {
                            chaveAtual = obterProximaChaveGemini();
                            logTentativas.push(`[Rota: ${urlTeste} - Tentativa ${tentativa}]: Erro 429 (Cota Excedida do Gemini). Alternando chave.`);
                            continue; 
                        }

                        if (respostaNuvem.ok) {
                            const dadosIa = await respostaNuvem.json();
                            respostaTexto = dadosIa.resposta || dadosIa.text || dadosIa.message || dadosIa.resultado || JSON.stringify(dadosIa);
                            sucesso = true;
                            break;
                        } else {
                            logTentativas.push(`[Rota: ${urlTeste} - Tentativa ${tentativa}]: Código HTTP ${respostaNuvem.status}`);
                        }
                    } catch (err) {
                        logTentativas.push(`[Rota: ${urlTeste} - Tentativa ${tentativa}]: Erro de Conexão/Timeout (${err.message})`);
                    }
                }
                if (sucesso) break;
            }

            if (!sucesso) {
                return res.status(502).json({ 
                    error: true, 
                    text: "Falha ao contatar Morador IA após tentativas.", 
                    historicoRotas: logTentativas 
                });
            }
        } else {
            respostaTexto = `[Dashboard Local]: Respondendo via Motor Interno Local: "${message}"`;
        }
        res.json({ text: respostaTexto, timestamp: new Date().toISOString() });
    } catch (error) {
        next(error);
    }
});

app.use((err, req, res, next) => {
    console.error("Erro centralizado do servidor:", err.message);
    res.status(500).json({ error: true, message: 'Erro no processamento interno do servidor.' });
});

app.listen(PORT, () => {
    console.log(`Dashboard rodando na porta física ${PORT}`);
});
