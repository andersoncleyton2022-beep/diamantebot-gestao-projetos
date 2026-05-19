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

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, 'bot_projeto.zip')
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let botState = { isRunning: false, processRef: null };
let ultimoArquivoZip = null;

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    ultimoArquivoZip = req.file.path;
    res.status(200).json({ 
        success: true, 
        message: 'Arquivo .zip recebido com sucesso no Render!' 
    });
});

app.get('/api/engine/status', (req, res) => {
    res.json({ status: botState.isRunning ? 'online' : 'offline' });
});

app.post('/api/engine/start', async (req, res, next) => {
    try {
        if (!ultimoArquivoZip || !fs.existsSync(ultimoArquivoZip)) {
            return res.status(400).json({ error: 'Envie o arquivo .zip antes de iniciar o motor.' });
        }

        console.log('Extraindo arquivos do bot no servidor...');
        const zip = new AdmZip(ultimoArquivoZip);
        zip.extractAllTo(extractDir, true);

        console.log('Instalando dependências do bot enviado...');
        exec('npm install', { cwd: extractDir }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Erro no npm install do bot: ${error.message}`);
            }
            
            let mainFile = 'index.js';
            if (!fs.existsSync(path.join(extractDir, 'index.js'))) {
                if (fs.existsSync(path.join(extractDir, 'bot.js'))) mainFile = 'bot.js';
                else if (fs.existsSync(path.join(extractDir, 'main.js'))) mainFile = 'main.js';
            }

            console.log(`Iniciando o arquivo do bot: ${mainFile}`);
            
            botState.processRef = exec(`node ${mainFile}`, { cwd: extractDir });
            botState.isRunning = true;

            botState.processRef.stdout.on('data', (data) => console.log(`[Bot Ativo]: ${data}`));
            botState.processRef.stderr.on('data', (data) => console.error(`[Bot Erro]: ${data}`));
        });

        res.json({ 
            success: true, 
            status: 'online', 
            message: 'O Render está descompactando e ligando o seu Bot agora!' 
        });

    } catch (error) {
        next(error);
    }
});

app.post('/api/chat', upload.single('media'), async (req, res, next) => {
    try {
        const { message } = req.body;
        let responseText = "Processando sua solicitação...";

        if (req.file) {
            responseText = `Arquivo de mídia recebido e enviado ao motor do bot.`;
        } else if (message) {
            responseText = `DiamanteBot respondeu para: "${message}"`;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        res.json({ text: responseText, timestamp: new Date().toISOString() });
    } catch (error) {
        next(error);
    }
});

app.use((err, req, res, next) => {
    console.error('Erro interno detectado:', err.stack);
    res.status(500).json({
        error: true,
        message: 'Ocorreu um erro interno no processamento do motor.',
        details: err.message
    });
});

app.listen(PORT, () => {
    console.log(`Servidor do Dashboard ativo na porta ${PORT}`);
});
