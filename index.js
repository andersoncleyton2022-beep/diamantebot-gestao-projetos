const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

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

// Configuração do Novo Motor (Diamantebot FastAPI)
// IMPORTANTE: Adicione a URL do seu painel Python nas variáveis de ambiente do Render como DIAMANTE_MOTOR_URL
const DIAMANTE_MOTOR_URL = process.env.DIAMANTE_MOTOR_URL || "URL_DO_SEU_PAINEL_PYTHON_NO_RENDER";
const APY_KEY_INTERNA = process.env.DIAMANTE_API_KEY || "SUA_CHAVE_GERADA_NO_PAINEL_SQLITE";

let botState = { 
    isRunning: true, 
    status: 'online'
};

// Rota Suprema Anti-Sono para UptimeRobot
app.all('/ping', (req, res) => {
    res.status(200).send('pong - DiamanteBot acordado!');
});
app.head('/', (req, res) => {
    res.status(200).end();
});

app.get('/api/engine/status', (req, res) => {
    res.json({ 
        status: botState.isRunning ? 'online' : 'offline',
        motorUrl: DIAMANTE_MOTOR_URL
    });
});

// Filtro de Arquivos do Painel Lateral
app.get('/api/dashboard/arquivos', async (req, res) => {
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
// 💬 CHAT: INTEGRAÇÃO DIRETA COM O DIAMANTEBOT (FASTAPI)
// ==========================================================================
app.post('/api/chat', multer().single('media'), async (req, res, next) => {
    const { message } = req.body;
    
    if (!message) {
        return res.json({ text: "Nenhuma mensagem recebida.", timestamp: new Date().toISOString() });
    }

    // Monta o histórico no formato estrito que o nosso processar_resposta_chat espera
    const history_openai_format = [
        { role: "user", content: message }
    ];

    try {
        // Envio direto para o nosso painel Python rodando no Render
        const respostaPainel = await fetch(`${DIAMANTE_MOTOR_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${APY_KEY_INTERNA}` // Validação da chave salva no SQLite
            },
            body: JSON.stringify({ 
                model: "diamantebot",
                messages: history_openai_format,
                max_tokens: 1024,
                temperature: 0.7
            })
        });

        if (!respostaPainel.ok) {
            const txtErro = await respostaPainel.text();
            return res.json({ 
                text: `Erro no motor de IA [${respostaPainel.status}]: ${txtErro}`, 
                timestamp: new Date().toISOString() 
            });
        }

        const dadosIa = await respostaPainel.json();
        
        // Captura cirúrgica baseada no dicionário universal que implementamos
        const respostaTexto = dadosIa.choices[0].message.content;

        res.json({ text: respostaTexto, timestamp: new Date().toISOString() });

    } catch (erroFetch) {
        console.error(`[Falha de conexão com o Motor]: ${erroFetch.message}`);
        res.json({ 
            text: `Erro de comunicação: Não foi possível conectar ao motor do DiamanteBot. Detalhe: ${erroFetch.message}`, 
            timestamp: new Date().toISOString() 
        });
    }
});

app.use((err, req, res, next) => {
    console.error('Erro Interno:', err.stack);
    res.status(500).json({ error: true, message: 'Ocorreu um erro interno na fiação do servidor.' });
});

app.listen(PORT, () => {
    console.log(`Servidor do site rodando perfeitamente na porta ${PORT}`);
});
