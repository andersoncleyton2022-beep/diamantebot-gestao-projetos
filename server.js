const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Variável global para armazenar o caminho absoluto do Android configurado pelo usuário
let pastaRaizBot = '';

// Configuração flexível do Multer para salvar diretamente no caminho absoluto injetado
const storageConfig = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!pastaRaizBot) {
            return cb(new Error('A pasta raiz não foi configurada no dashboard.'), null);
        }
        // Garante que a pasta existe antes de salvar
        if (!fs.existsSync(pastaRaizBot)) {
            fs.mkdirSync(pastaRaizBot, { recursive: true });
        }
        cb(null, pastaRaizBot);
    },
    filename: function (req, file, cb) {
        // Preserva o nome original ou define formato para áudios do hold-to-talk
        cb(null, file.originalname || `gravacao_${Date.now()}.wav`);
    }
});
const upload = multer({ storage: storageConfig });

// Rota 1: Configurar a pasta raiz absoluta (Android ou PC)
app.post('/configurar', (req, res) => {
    const { caminho } = req.body;
    if (!caminho) {
        return res.status(400).json({ success: false, msg: 'Caminho não fornecido.' });
    }

    try {
        // Resolve o caminho enviado para garantir conformidade absoluta
        pastaRaizBot = path.resolve(caminho);
        
        if (!fs.existsSync(pastaRaizBot)) {
            fs.mkdirSync(pastaRaizBot, { recursive: true });
        }
        
        console.log(`[RAIZ CONFIGURADA] -> Mapeada para: ${pastaRaizBot}`);
        res.json({ success: true, msg: 'Caminho absoluto definido com sucesso.' });
    } catch (error) {
        res.status(500).json({ success: false, msg: `Erro ao acessar o caminho: ${error.message}` });
    }
});

// Rota 2: Inicialização simulada do Motor da IABB/Bot
app.post('/iniciar', (req, res) => {
    if (!pastaRaizBot) {
        return res.json({ msg: 'Erro: Configure a pasta antes de iniciar o motor.' });
    }
    
    // Aqui você integrará a chamada do motor do seu DiamanteBot/IABB
    console.log(`[MOTOR] Iniciando leitura lógica da estrutura em: ${pastaRaizBot}`);
    res.json({ msg: `Motor iniciado com sucesso usando a raiz absoluta: ${pastaRaizBot}` });
});

// Rota 3: Interação de Chat (Integração de mensagens com o Motor)
app.post('/chat', (req, res) => {
    const { mensagem } = req.body;
    if (!pastaRaizBot) {
        return res.json({ resposta: 'Por favor, configure a pasta do bot primeiro.' });
    }

    // Exemplo de comportamento do bot respondendo e lendo/escrevendo arquivos na raiz
    console.log(`[MENSAGEM RECEBIDA]: ${mensagem}`);
    
    // Resposta simulada. Aqui entraria o retorno da IA do seu Bot.
    let respostaIA = `Recebi sua mensagem: "${mensagem}". O motor está operando em ${pastaRaizBot}.`;
    
    res.json({ resposta: respostaIA });
});

// Rota 4: Upload de Arquivos / Mídias / Gravações de Áudio diretamente na pasta
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, msg: 'Nenhum arquivo enviado.' });
    }
    console.log(`[ARQUIVO SALVO] -> ${req.file.path}`);
    res.json({ success: true, msg: 'Arquivo armazenado com sucesso na pasta raiz do bot.', arquivo: req.file.filename });
});

// Rota 5: Listar todos os arquivos criados ou disponíveis na pasta do Bot
app.get('/arquivos', (req, res) => {
    if (!pastaRaizBot || !fs.existsSync(pastaRaizBot)) {
        return res.json({ arquivos: [] });
    }
    
    fs.readdir(pastaRaizBot, (err, files) => {
        if (err) return res.json({ arquivos: [] });
        // Filtra apenas arquivos visíveis (ignora pastas e ocultos para simplificar)
        const apenasArquivos = files.filter(file => {
            return fs.statSync(path.join(pastaRaizBot, file)).isFile();
        });
        res.json({ arquivos: apenasArquivos });
    });
});

// Rota 6: Download/Visualização dos arquivos listados
app.get('/baixar/:nomeArquivo', (req, res) => {
    if (!pastaRaizBot) return res.status(400).send('Pasta não configurada.');
    
    const arquivoPath = path.join(pastaRaizBot, req.params.nomeArquivo);
    if (fs.existsSync(arquivoPath)) {
        res.download(arquivoPath);
    } else {
        res.status(404).send('Arquivo não encontrado.');
    }
});

// Inicialização do Servidor Geral
app.listen(PORT, () => {
    console.log(`==================================================================`);
    console.log(` Dashboard DiamanteBot Ativo localmente!`);
    console.log(` Acesse em seu navegador: http://localhost:${PORT}`);
    console.log(`==================================================================`);
});
