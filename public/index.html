<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DiamanteBot - Configuração</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <h2>DIAMANTE BOT</h2>
        <p style="color: #888;">Deploy & Inicialização de Motor</p>
        
        <div class="diamond-container">
            <div class="diamond"></div>
        </div>

        <!-- Mecanismo de Upload do ZIP Local -->
        <input type="file" id="fileInput" accept=".zip" style="display: none;">
        <button type="button" onclick="document.getElementById('fileInput').click()">Upload de Arquivo .ZIP</button>
        
        <div class="progress-bar" id="progressBar">
            <div class="progress-fill" id="progressFill"></div>
        </div>
        <p id="uploadStatus" style="font-size: 14px; margin-top: 5px;"></p>

        <!-- Mecanismo de Integração com a IA Bebê Nuvem -->
        <div style="margin-top: 20px; padding: 15px; border: 1px dashed var(--accent-color); border-radius: 8px; background: rgba(0,0,0,0.2);">
            <p style="margin: 0 0 10px 0; font-size: 14px; color: var(--accent-color);">🔗 Conectar IA da Nuvem (Render)</p>
            <input type="text" id="iaUrlInput" placeholder="Ex: https://onrender.com" style="width: 90%; padding: 10px; background: #111; border: 1px solid #333; color: #fff; border-radius: 6px;">
            <button id="connectIaBtn" style="margin-top: 10px; background: var(--accent-color); color: #000;">Iniciar IA Bebê Nuvem</button>
            <p id="iaStatusText" style="font-size: 12px; margin-top: 5px; color: #888;"></p>
        </div>

        <!-- Disparador do Motor Geral -->
        <button id="startBtn" disabled style="margin-top: 20px;">Iniciar Motor Principal</button>
        <button onclick="window.location.href='/chat.html'" style="border-color: #fff; color: #fff; margin-top: 10px;">Ir para o Chat</button>
    </div>

    <script>
        const fileInput = document.getElementById('fileInput');
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        const uploadStatus = document.getElementById('uploadStatus');
        const startBtn = document.getElementById('startBtn');
        
        const iaUrlInput = document.getElementById('iaUrlInput');
        const connectIaBtn = document.getElementById('connectIaBtn');
        const iaStatusText = document.getElementById('iaStatusText');

        iaUrlInput.value = "https://onrender.com";

        connectIaBtn.addEventListener('click', async () => {
            const url = iaUrlInput.value.trim();
            if(!url) return alert('Insira o link do seu Render.');
            iaStatusText.innerText = "Conectando e acordando a IA Bebê...";
            iaStatusText.style.color = "#fff";

            try {
                const response = await fetch('/api/ia/conectar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                });
                const data = await response.json();
                if(data.success) {
                    iaStatusText.innerText = "IA Bebê Conectada com Sucesso!";
                    iaStatusText.style.color = "#2ecc71";
                    startBtn.disabled = false;
                }
            } catch (err) {
                iaStatusText.innerText = "Erro ao conectar.";
                iaStatusText.style.color = "#e74c3c";
            }
        });

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;

            progressBar.style.display = 'block';
            progressFill.style.width = '0%';
            uploadStatus.innerText = 'Enviando ZIP...';

            const formData = new FormData();
            formData.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    progressFill.style.width = (e.loaded / e.total) * 100 + '%';
                }
            };
            xhr.onload = function() {
                const res = JSON.parse(xhr.responseText);
                if (xhr.status === 200 && res.success) {
                    uploadStatus.innerText = 'Sucesso: ZIP Pronto!';
                    uploadStatus.style.color = '#2ecc71';
                    startBtn.disabled = false;
                }
            };
            xhr.send(formData);
        });

        startBtn.addEventListener('click', async () => {
            const response = await fetch('/api/engine/start', { method: 'POST' });
            const data = await response.json();
            if(data.success) {
                alert(data.message);
                window.location.href = '/chat.html';
            }
        });
    </script>
</body>
</html>
