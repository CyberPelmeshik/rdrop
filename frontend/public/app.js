const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`;

console.log('[rDrop] WebSocket URL:', WS_URL);

// ---- State ----
let ws = null;
let myName = '';
let myId = '';
let users = [];
let selectedUserId = null;
let receivedFiles = [];

// ---- DOM refs ----
const nameInput = document.getElementById('name-input');
const nameSaveBtn = document.getElementById('name-save-btn');
const userList = document.getElementById('user-list');
const userCount = document.getElementById('user-count');
const selectedUserEl = document.getElementById('selected-user');
const fileInput = document.getElementById('file-input');
const sendBtn = document.getElementById('send-btn');
const receivedList = document.getElementById('received-list');
const connectionStatus = document.getElementById('connection-status');
const fileNameLabel = document.getElementById('file-name-label');

// ---- WebSocket ----
function connect() {
  console.log('[rDrop] Подключение к', WS_URL);
  setStatus('connecting', 'Подключение...');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[rDrop] WebSocket открыт');
    setStatus('connected', 'Подключено');
    if (myName) {
      sendCommand('change_name', [myName]);
    }
  };

  ws.onmessage = (event) => {
    console.log('[rDrop] Получено сообщение, тип данных:', typeof event.data, 'длина:', typeof event.data === 'string' ? event.data.length : event.data.size);
    if (event.data instanceof Blob) {
      handleIncomingFile(event.data);
      return;
    }
    // Text message – JSON command from server
    try {
      const msg = JSON.parse(event.data);
      console.log('[rDrop] Команда от сервера:', msg);
      if (msg.type === 'user_list') {
        users = (msg.users || []).filter(u => u.id !== myId);
        console.log('[rDrop] Список пользователей:', users.length);
        renderUserList();
      }
      if (msg.type === 'welcome') {
        myId = msg.id;
      }
    } catch {
      console.log('[rDrop] Не-JSON сообщение:', event.data);
    }
  };

  ws.onclose = (event) => {
    console.log('[rDrop] WebSocket закрыт, код:', event.code, 'причина:', event.reason);
    setStatus('disconnected', 'Отключено — переподключение...');
    setTimeout(connect, 2000);
  };

  ws.onerror = (event) => {
    console.error('[rDrop] Ошибка WebSocket:', event);
    setStatus('disconnected', 'Ошибка соединения');
  };
}

function sendCommand(name, args = []) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ name, args }));
}

function setStatus(cls, text) {
  connectionStatus.className = `status-badge ${cls}`;
  connectionStatus.textContent = text;
}

// ---- User list rendering ----
function renderUserList() {
  userCount.textContent = users.length;

  if (users.length === 0) {
    userList.innerHTML = '<li class="empty-hint">Пока никого нет</li>';
    return;
  }

  userList.innerHTML = users
    .map(
      (u) => `
      <li class="user-item ${u.id === selectedUserId ? 'selected' : ''}">
        <div class="user-avatar">${avatarLetter(u.name)}</div>
        <span class="user-name">${escapeHtml(u.name || 'Аноним')}</span>
        <button class="btn-select" data-id="${u.id}">
          ${u.id === selectedUserId ? '✓ Выбран' : 'Выбрать'}
        </button>
      </li>`
    )
    .join('');

  // Attach click handlers
  userList.querySelectorAll('.btn-select').forEach((btn) => {
    btn.addEventListener('click', () => selectUser(btn.dataset.id));
  });
}

function selectUser(id) {
  selectedUserId = id;
  const user = users.find((u) => u.id === id);
  selectedUserEl.textContent = user ? user.name || 'Аноним' : id;
  selectedUserEl.classList.add('has-recipient');
  sendCommand('sent_to', [id]);
  renderUserList();
}

function avatarLetter(name) {
  return (name || '?')[0].toUpperCase();
}

// ---- File sending ----
sendBtn.addEventListener('click', () => {
  if (!selectedUserId) {
    alert('Сначала выберите получателя из списка.');
    return;
  }
  const file = fileInput.files[0];
  if (!file) {
    alert('Выберите файл для отправки.');
    return;
  }
  file.arrayBuffer().then((buf) => {
    // Build metadata header
    const meta = JSON.stringify({
      name: file.name,
      type: file.type,
      size: file.size,
    });
    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(meta);

    // 4-byte big-endian length prefix
    const header = new ArrayBuffer(4);
    new DataView(header).setUint32(0, metaBytes.length, false);

    // Combine: header + JSON metadata + file bytes
    const fileBytes = new Uint8Array(buf);
    const combined = new Uint8Array(
      4 + metaBytes.length + fileBytes.length
    );
    combined.set(new Uint8Array(header), 0);
    combined.set(metaBytes, 4);
    combined.set(fileBytes, 4 + metaBytes.length);

    ws.send(combined.buffer);
    fileNameLabel.textContent = 'Отправлено ✓';
    fileInput.value = '';
    setTimeout(() => {
      fileNameLabel.textContent = 'Файл не выбран';
    }, 2500);
  });
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileNameLabel.textContent = file ? file.name : 'Файл не выбран';
});

// ---- File receiving ----
function handleIncomingFile(blob) {
  blob.arrayBuffer().then((buf) => {
    const view = new DataView(buf);
    if (buf.byteLength < 4) return;

    // Read JSON metadata length (big-endian)
    const metaLen = view.getUint32(0, false);
    if (4 + metaLen > buf.byteLength) return;

    // Extract JSON metadata
    const metaBytes = new Uint8Array(buf, 4, metaLen);
    const decoder = new TextDecoder();
    const meta = JSON.parse(decoder.decode(metaBytes));

    // Extract file body
    const fileBytes = new Uint8Array(buf, 4 + metaLen);
    const fileBlob = new Blob([fileBytes], { type: meta.type || '' });
    const url = URL.createObjectURL(fileBlob);

    const entry = {
      id: crypto.randomUUID(),
      url,
      name: meta.name || `file-${receivedFiles.length + 1}`,
      time: new Date().toLocaleTimeString(),
    };
    receivedFiles.unshift(entry);
    renderReceivedFiles();
  });
}

function renderReceivedFiles() {
  if (receivedFiles.length === 0) {
    receivedList.innerHTML = '<li class="empty-hint">Нет полученных файлов</li>';
    return;
  }
  receivedList.innerHTML = receivedFiles
    .map(
      (f) => `
      <li class="file-item">
        <span class="file-icon">📥</span>
        <span class="file-name">${f.name}</span>
        <span class="file-time">${f.time}</span>
        <a class="btn-download" href="${f.url}" download>Скачать</a>
      </li>`
    )
    .join('');
}

// ---- Name ----
nameSaveBtn.addEventListener('click', () => {
  myName = nameInput.value.trim();
  if (myName) {
    sendCommand('change_name', [myName]);
  }
});

// ---- Helpers ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Init ----
connect();
renderUserList();
renderReceivedFiles();
