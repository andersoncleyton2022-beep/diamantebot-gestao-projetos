const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const { fork } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Configuração do caminho de armazenamento persistente do Render
// Se rodar localmente no PC ou Termux, ele criará automaticamente uma pasta 'render_data' na raiz
const PASTA_PERSISTENTE = process.env.RENDER 
    ? '/opt/render/project/src/data' 
    : path.join(__dirname, 'render_data');

const PASTA_PROJETOS = path.join(PASTA_PERSISTENTE, 'projetos');
const PASTA_UPLOADS_TEMP = path.join(PASTA_PERSISTENTE, 'uploads_temp');

// Inicializa a estrutura de diretórios no disco rígido persistente
[PASTA_PERSISTENTE, PASTA_PROJETOS, PASTA_UPLOADS_TEMP].forEach(pasta => {
    if (!fs.existsSync(pasta)) {
        fs.mkdirSync(pasta, { recursive: true });
    }
});

let projetoAtivo = '';
let processoMotor = null;
let conexoesLogs = [];

// Transmissão de Logs em tempo real para a interface
function enviarLogParaInterface(mensagem) {
    const dados = JSON.stringify({ timestamp: new Date().toLocaleTimeString(), msg: mensagem });
    conexoesLogs.forEach(res => res.write(`data: ${dados}\n\n`));
}

// Endpoint do fluxo de eventos contínuo (SSE)
app.get('/fluxo-logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    conexoesLogs.push(res);
    req.on('close', () => {
        conexoesLogs = conexoesLogs.filter(conexao => conexao !== res);
    });
});

// Upload de projetos configurado para o diretório persistente
const uploadZip = multer({ dest: PASTA_UPLOADS_TEMP });

app.post('/upload-projeto', uploadZip.single('arquivoZip'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, msg: 'Nenhum arquivo enviado.' });
    }

    const nomeProjeto = path.parse(req.file.originalname).name.replace(/\s+/g, '_');
    const caminhoDestino = path.join(PASTA_PROJETOS, nomeProjeto);

    try {
        // Descompactação direta na partição persistente
        await fs.createReadStream(req.file.path)
            .pipe(unzipper.Extract({ path: caminhoDestino }))
            .promise();

        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        enviarLogParaInterface(`[Painel] Projeto '${nomeProjeto}' extraído e armazenado no disco persistente.`);
        res.json({ success: true, msg: `Projeto '${nomeProjeto}' instalado com sucesso!` });
    } catch (error) {
        res.status(500).json({ success: false, msg: `Erro ao descompactar projeto: ${error.message}` });
    }
});

// Listar Projetos salvos no volume
app.get('/listar-projetos', (req, res) => {
    fs.readdir(PASTA_PROJETOS, (err, files) => {
        if (err) return res.json({ projetos: [] });
        const projetos = files.filter(file => fs.statSync(path.join(PASTA_PROJETOS, file)).isDirectory());
        res.json({ projetos });
    });
});

// Mudar escopo do Projeto Ativo
app.post('/selecionar-projeto', (req, res) => {
    const { nome } = req.body;
    const caminho = path.join(PASTA_PROJETOS, nome);

    if (fs.existsSync(caminho)) {
        projetoAtivo = nome;
        enviarLogParaInterface(`[Painel] Mudança de escopo ativa. Projeto selecionado: ${nome}`);
        res.json({ success: true, msg: `Projeto '${nome}' selecionado.` });
    } else {
        res.status(404).json({ success: false, msg: 'Projeto não encontrado no armazenamento.' });
    }
});

// INICIAR MOTOR (Execução dinâmica com transmissão de Stdout/Stderr)
app.post('/iniciar-motor', (req, res) => {
    if (!projetoAtivo) {
        return res.json({ success: false, msg: 'Selecione um projeto antes de iniciar o motor.' });
    }

    const caminhoIndex = path.join(PASTA_PROJETOS, projetoAtivo, 'index.js');

    if (!fs.existsSync(caminhoIndex)) {
        return res.json({ success: false, msg: `Erro: O arquivo 'index.js' não existe na pasta do projeto '${projetoAtivo}'.` });
    }

    if (processoMotor) {
        processoMotor.kill();
    }

    enviarLogParaInterface(`[Motor] Ativando sub-processo do bot em: ${projetoAtivo}`);
    
    processoMotor = fork(caminhoIndex, [], {
        cwd: path.join(PASTA_PROJETOS, projetoAtivo),
        silent: true
    });

    processoMotor.stdout.on('data', (data) => {
        enviarLogParaInterface(data.toString().trim());
    });

    processoMotor.stderr.on('data', (data) => {
        enviarLogParaInterface(`[ERRO BOT]: ${data.toString().trim()}`);
    });

    processoMotor.on('close', (code) => {
        enviarLogParaInterface(`[Motor] Bot finalizado/interrompido (Código: ${code || 0})`);
        processoMotor = null;
    });

    res.json({ success: true, msg: `Motor do projeto '${projetoAtivo}' iniciado.` });
});

// PARAR MOTOR (Encerra o processo de forma limpa e imediata)
app.post('/parar-motor', (req, res) => {
    if (processoMotor) {
        processoMotor.kill();
        processoMotor = null;
        enviarLogParaInterface(`[Painel] Comando manual executado: Bot encerrado.`);
        res.json({ success: true, msg: 'Motor interrompido com sucesso.' });
    } else {
        res.json({ success: false, msg: 'Não há nenhum motor em execução.' });
    }
});

// Monitorar arquivos criados ou modificados pelo Bot ativo
app.get('/arquivos-projeto', (req, res) => {
    if (!projetoAtivo) return res.json({ arquivos: [] });

    const caminhoProjeto = path.join(PASTA_PROJETOS, projetoAtivo);
    fs.readdir(caminhoProjeto, (err, files) => {
        if (err) return res.json({ arquivos: [] });
        const arquivosGerados = files.filter(file => {
            const fullPath = path.join(caminhoProjeto, file);
            return fs.statSync(fullPath).isFile() && file !== 'index.js';
        });
        res.json({ arquivos: arquivosGerados });
    });
});

// Download de Logs/PDFs salvos no disco persistente do Render
app.get('/baixar-arquivo/:nomeArquivo', (req, res) => {
    if (!projetoAtivo) return res.status(400).send('Nenhum projeto ativo.');
    const arquivoPath = path.join(PASTA_PROJETOS, projetoAtivo, req.params.nomeArquivo);
    if (fs.existsSync(arquivoPath)) {
        res.download(arquivoPath);
    } else {
        res.status(404).send('Arquivo não encontrado.');
    }
});

app.listen(PORT, () => {
    console.log(`==================================================================`);
    console.log(` Dashboard Operando em Modo de Persistência Avançado!`);
    console.log(` Raiz de armazenamento definida em: ${PASTA_PERSISTENTE}`);
    console.log(`==================================================================`);
});
