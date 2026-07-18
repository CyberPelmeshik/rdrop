const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`;

console.log('[rDrop] WebSocket URL:', WS_URL);

// ---- State ----
let ws = null;
let myName = '';
let myId = '';
let users = [];
let selectedUserId = null;
let receivedFiles = [];
const transfers = new Map(); // transfer_id → { name, type, size, totalChunks, received, ended, writer, fileHandle, pendingChunks }
const CHUNK_SIZE = 64 * 1024; // 64 KB

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

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (HTTP without localhost)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

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
      if (msg.name === 'transfer_start') {
        const [transferId, name, mimeType, size, totalChunks] = msg.args;
        transfers.set(transferId, {
          name,
          type: mimeType,
          size: Number(size),
          totalChunks: Number(totalChunks),
          received: 0,
          ended: false,
          writer: null,
          fileHandle: null,
          pendingChunks: [],
        });
        initOPFSWriter(transferId, name);
        console.log('[rDrop] Начало трансфера:', name, 'чанков:', totalChunks);
      }
      if (msg.name === 'transfer_end') {
        const transferId = msg.args[0];
        const transfer = transfers.get(transferId);
        if (transfer) {
          transfer.ended = true;
          if (transfer.writer && transfer.received === transfer.totalChunks) {
            finalizeOPFSTransfer(transferId);
          } else if (transfer.chunks && transfer.received === transfer.totalChunks) {
            assembleInMemory(transfer);
            transfers.delete(transferId);
          }
        }
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
  sendFile(file).then(() => {
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

// ---- File sending (chunked) ----
async function sendFile(file) {
  const transferId = generateUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // Notify receiver
  sendCommand('transfer_start', [
    transferId,
    file.name,
    file.type || '',
    String(file.size),
    String(totalChunks),
  ]);

  const encoder = new TextEncoder();
  const idBytes = encoder.encode(transferId);
  const headerSize = 8 + idBytes.length;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const buf = await chunk.arrayBuffer();

    const combined = new Uint8Array(headerSize + buf.byteLength);
    const view = new DataView(combined.buffer);
    view.setUint32(0, idBytes.length, false);
    combined.set(idBytes, 4);
    view.setUint32(4 + idBytes.length, i, false);
    combined.set(new Uint8Array(buf), headerSize);

    ws.send(combined.buffer);
  }

  sendCommand('transfer_end', [transferId]);
}

// ---- File receiving (OPFS streaming) ----
function handleIncomingFile(blob) {
  blob.arrayBuffer().then((buf) => {
    const view = new DataView(buf);
    if (buf.byteLength < 8) return;

    const idLen = view.getUint32(0, false);
    if (8 + idLen > buf.byteLength) return;

    const idBytes = new Uint8Array(buf, 4, idLen);
    const decoder = new TextDecoder();
    const transferId = decoder.decode(idBytes);

    const chunkIndex = view.getUint32(4 + idLen, false);
    const dataStart = 8 + idLen;
    const chunkData = new Uint8Array(buf, dataStart);

    const transfer = transfers.get(transferId);
    if (!transfer) return;

    transfer.received++;

    if (transfer.writer) {
      // Writer is ready — write directly to OPFS
      transfer.writer.write({ type: 'write', position: chunkIndex * CHUNK_SIZE, data: chunkData });
      if (transfer.ended && transfer.received === transfer.totalChunks) {
        finalizeOPFSTransfer(transferId);
      }
    } else if (transfer.chunks) {
      // In-memory fallback active (OPFS unavailable)
      transfer.chunks[chunkIndex] = chunkData;
      if (transfer.ended && transfer.received === transfer.totalChunks) {
        assembleInMemory(transfer);
        transfers.delete(transferId);
      }
    } else {
      // Writer not ready yet — buffer until initOPFSWriter decides
      transfer.pendingChunks.push({ chunkIndex, chunkData });
    }
  });
}

async function initOPFSWriter(transferId, name) {
  const transfer = transfers.get(transferId);
  if (!transfer) return;

  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(name, { create: true });
    const writer = await fileHandle.createWritable();

    transfer.fileHandle = fileHandle;
    transfer.writer = writer;

    // Flush buffered chunks that arrived before writer was ready
    for (const { chunkIndex, chunkData } of transfer.pendingChunks) {
      await writer.write({ type: 'write', position: chunkIndex * CHUNK_SIZE, data: chunkData });
    }
    transfer.pendingChunks = [];

    // Check if transfer_end already arrived and all chunks are written
    if (transfer.ended && transfer.received === transfer.totalChunks) {
      await finalizeOPFSTransfer(transferId);
    }
  } catch (e) {
    console.warn('[rDrop] OPFS unavailable, using in-memory fallback:', e.message);
    transfer.chunks = [];
    for (const { chunkIndex, chunkData } of transfer.pendingChunks) {
      transfer.chunks[chunkIndex] = chunkData;
    }
    transfer.pendingChunks = [];

    if (transfer.ended && transfer.received === transfer.totalChunks) {
      assembleInMemory(transfer);
      transfers.delete(transferId);
    }
  }
}

function assembleInMemory(transfer) {
  const fileBytes = new Uint8Array(transfer.size);
  let offset = 0;
  for (const chunk of transfer.chunks) {
    fileBytes.set(chunk, offset);
    offset += chunk.length;
  }
  const blob = new Blob([fileBytes], { type: transfer.type || '' });
  const url = URL.createObjectURL(blob);
  const entry = {
    id: generateUUID(),
    url,
    name: transfer.name || `file-${receivedFiles.length + 1}`,
    time: new Date().toLocaleTimeString(),
  };
  receivedFiles.unshift(entry);
  renderReceivedFiles();
  console.log('[rDrop] Трансфер завершён (in-memory):', transfer.name);
}

async function finalizeOPFSTransfer(transferId) {
  const transfer = transfers.get(transferId);
  if (!transfer) return;

  try {
    await transfer.writer.close();
    const file = await transfer.fileHandle.getFile();
    const url = URL.createObjectURL(file);
    const entry = {
      id: generateUUID(),
      url,
      name: transfer.name || `file-${receivedFiles.length + 1}`,
      time: new Date().toLocaleTimeString(),
    };
    receivedFiles.unshift(entry);
    renderReceivedFiles();
    console.log('[rDrop] Трансфер завершён:', transfer.name);
  } catch (e) {
    console.error('[rDrop] OPFS finalize failed:', e);
  }

  transfers.delete(transferId);
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
