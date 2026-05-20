const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
const extractDir = path.join(__dirname, 'uploads', 'bot-extraido');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });

// Configuração para o upload do ZIP do motor local
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, 'bot_projeto.zip')
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado Geral Unificado do Sistema
let botState = { 
    isRunning: false, 
    iaCloudUrl: "https://onrender.com",
    tipoConexao: 'nuvem',
    processRef: null
};
let ultimoArquivoZip = null;

// Endpoint de Upload do ZIP (Configurador)
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    ultimoArquivoZip = req.file.path;
    botState.tipoConexao = 'local'; // Muda para local se o usuário optar por subir um ZIP
    res.status(200).json({ 
        success: true, 
        message: 'Arquivo .zip recebido com sucesso no Render!' 
    });
});

// Endpoint para vincular o link da IA Bebê na Nuvem
app.post('/api/ia/conectar', (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ success: false, message: 'URL não fornecida.' });
    }
    botState.iaCloudUrl = url.replace(/\/$/, ""); 
    botState.tipoConexao = 'nuvem';
    res.json({ success: true, message: 'Link da IA Bebê sincronizado!' });
});

// Endpoint para Ligar o Motor (Suporta tanto o ZIP extraído quanto a IA na Nuvem)
app.post('/api/engine/start', async (req, res, next) => {
    try {
        if (botState.tipoConexao === 'local') {
            if (!ultimoArquivoZip || !fs.existsSync(ultimoArquivoZip)) {
                return res.status(400).json({ error: 'Envie o arquivo .zip antes de iniciar o motor local.' });
            }

            console.log('Extraindo arquivos do ZIP local no servidor...');
            const zip = new AdmZip(ultimoArquivoZip);
            zip.extractAllTo(extractDir, true);

            console.log('Instalando dependências do bot extraído...');
            exec('npm install', { cwd: extractDir }, (error) => {
                if (error) console.error(`Aviso no npm install local: ${error.message}`);
                
                let mainFile = 'index.js';
                if (!fs.existsSync(path.join(extractDir, 'index.js'))) {
                    if (fs.existsSync(path.join(extractDir, 'bot.js'))) mainFile = 'bot.js';
                    else if (fs.existsSync(path.join(extractDir, 'main.js'))) mainFile = 'main.js';
                }

                console.log(`Iniciando arquivo principal: ${mainFile}`);
                botState.processRef = exec(`node ${mainFile}`, { cwd: extractDir });
                botState.isRunning = true;

                botState.processRef.stdout.on('data', (data) => console.log(`[Bot Ativo]: ${data}`));
                botState.processRef.stderr.on('data', (data) => console.error(`[Bot Erro]: ${data}`));
            });

            return res.json({ success: true, status: 'online', message: 'Motor local extraído e sendo iniciado em segundo plano!' });
        } 
        
        // Se a conexão for do tipo Nuvem (IA Bebê)
        botState.isRunning = true;
        res.json({ 
            success: true, 
            status: 'online', 
            message: 'Dashboard sincronizado com a sua IA Bebê na Nuvem com sucesso!' 
        });

    } catch (error) {
        next(error);
    }
});

// Endpoint de Status do Bot
app.get('/api/engine/status', (req, res) => {
    res.json({ status: botState.isRunning ? 'online' : 'offline' });
});

// Buscar lista de arquivos do servidor da IA Bebê na Nuvem
app.get('/api/dashboard/arquivos', async (req, res) => {
    if (!botState.iaCloudUrl) return res.json([]);
    try {
        const respostaMotor = await fetch(`${botState.iaCloudUrl}/api/sistema/arquivos`);
        const dadosArquivos = await respostaMotor.json();
        res.json(dadosArquivos);
    } catch (error) {
        res.status(500).json({ error: true, message: "Não foi possível ler os arquivos remotos." });
    }
});

// Chat Inteligente Multimídia (Aceita Texto, Fotos, Áudios, Vídeos e Documentos)
app.post('/api/chat', multer().single('media'), async (req, res, next) => {
    try {
        const { message } = req.body;
        let respostaTexto = "";

        // Se houver arquivo enviado no chat, identifica o tipo de mídia
        if (req.file) {
            const tipo = req.file.mimetype;
            console.log(`Mídia recebida no chat: ${req.file.originalname} (${tipo})`);
        }

        // Se estiver conectado à IA Bebê na Nuvem, encaminha os dados
        if (botState.tipoConexao === 'nuvem' && botState.iaCloudUrl) {
            try {
                const respostaNuvem = await fetch(`${botState.iaCloudUrl}/api/mensagem`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        mensagem: message || `[Arquivo de Mídia Enviado]`,
                        origem: "dashboard"
                    })
                });
                const dadosIa = await respostaNuvem.json();
                respostaTexto = dadosIa.resposta || dadosIa.message || "Processado pela IA Bebê.";
            } catch (err) {
                respostaTexto = `[IA Bebê Nuvem]: Recebi o comando, mas o link externo não respondeu.`;
            }
        } else {
            // Resposta simulada para o motor local do ZIP
            respostaTexto = req.file 
                ? `Motor local processou sua mídia: ${req.file.originalname}`
                : `DiamanteBot Local respondeu para: "${message}"`;
        }

        res.json({ text: respostaTexto, timestamp: new Date().toISOString() });
    } catch (error) {
        next(error);
    }
});

// Tratamento de Erros Centralizado (Evita quebras de código com DOCTYPE/HTML)
app.use((err, req, res, next) => {
    console.error('Erro:', err.stack);
    res.status(500).json({ error: true, message: 'Erro interno no processamento do motor.' });
});

app.listen(PORT, () => {
    console.log(`Servidor ativo na porta ${PORT}`);
});
