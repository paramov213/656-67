// Облако отключено. Celestra работает строго на локальной базе браузера (IndexedDB).
const DB_NAME = 'CelestraLocalDB';
const DB_VERSION = 1;

let db;
let myId = localStorage.getItem('celestraDeviceId');
let myProfile = JSON.parse(localStorage.getItem('celestraProfile')) || { nickname: '', avatar: 'https://via.placeholder.com/150/333333/FFFFFF?text=?' };
let activeChatUserId = null;
let activeChatId = null;

const elements = {
  myAvatar: document.getElementById('my-avatar'),
  avatarUpload: document.getElementById('avatar-upload'),
  avatarBtn: document.getElementById('profile-avatar-btn'),
  myNickname: document.getElementById('my-nickname'),
  myIdDisplay: document.getElementById('my-id-display'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  myChatsList: document.getElementById('my-chats-list'),
  chatHeader: document.getElementById('active-chat-header'),
  chatAvatar: document.getElementById('active-chat-avatar'),
  chatName: document.getElementById('active-chat-name'),
  chatId: document.getElementById('active-chat-id'),
  closeChatBtn: document.getElementById('close-chat-btn'),
  messagesArea: document.getElementById('messages-area'),
  emptyStateMsg: document.getElementById('empty-state-msg'),
  msgInputArea: document.getElementById('message-input-area'),
  msgInput: document.getElementById('message-input'),
  attachBtn: document.getElementById('attach-btn'),
  imageUpload: document.getElementById('image-upload'),
  voiceBtn: document.getElementById('voice-btn'),
  sendBtn: document.getElementById('send-btn')
};

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("Ошибка инициализации Celestra DB:", event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('users')) {
        database.createObjectStore('users', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('messages')) {
        const msgStore = database.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        msgStore.createIndex('chatId', 'chatId', { unique: false });
        msgStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

async function init() {
  await initDB();

  if (!myId) {
    myId = Math.random().toString(36).substring(2, 8).toUpperCase();
    localStorage.setItem('celestraDeviceId', myId);
  }
  
  elements.myIdDisplay.textContent = `ID: ${myId}`;
  elements.myNickname.value = myProfile.nickname;
  elements.myAvatar.src = myProfile.avatar;

  await syncProfileToLocalDb();
  setupEventListeners();
  renderMyChats();
  initServiceWorker();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

async function syncProfileToLocalDb() {
  const transaction = db.transaction(['users'], 'readwrite');
  const store = transaction.objectStore('users');
  store.put({
    id: myId,
    nickname: myProfile.nickname || `User-${myId}`,
    avatar: myProfile.avatar,
    lastActive: Date.now()
  });
}

function setupEventListeners() {
  elements.myNickname.addEventListener('blur', () => {
    myProfile.nickname = elements.myNickname.value;
    localStorage.setItem('celestraProfile', JSON.stringify(myProfile));
    syncProfileToLocalDb();
  });

  elements.avatarBtn.addEventListener('click', () => elements.avatarUpload.click());
  elements.avatarUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const base64Url = await fileToBase64(file);
      myProfile.avatar = base64Url;
      elements.myAvatar.src = base64Url;
      localStorage.setItem('celestraProfile', JSON.stringify(myProfile));
      syncProfileToLocalDb();
    }
  });

  let searchTimeout;
  elements.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const queryStr = e.target.value.trim().toUpperCase();
    
    if (queryStr.length < 2) {
      elements.searchResults.classList.add('hidden');
      return;
    }

    searchTimeout = setTimeout(() => performSearch(queryStr), 300);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-section')) {
      elements.searchResults.classList.add('hidden');
    }
  });

  elements.msgInput.addEventListener('input', (e) => {
    if (e.target.value.trim().length > 0) {
      elements.voiceBtn.classList.add('hidden');
      elements.sendBtn.classList.remove('hidden');
    } else {
      elements.voiceBtn.classList.remove('hidden');
      elements.sendBtn.classList.add('hidden');
    }
  });

  elements.sendBtn.addEventListener('click', () => sendTextMessage());
  elements.msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
  });

  elements.attachBtn.addEventListener('click', () => elements.imageUpload.click());
  elements.imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const base64Url = await fileToBase64(file);
      sendMessage(null, 'image', base64Url);
    }
  });

  setupVoiceRecording();

  elements.closeChatBtn.addEventListener('click', () => {
    activeChatUserId = null;
    activeChatId = null;
    elements.chatHeader.classList.add('hidden');
    elements.msgInputArea.classList.add('hidden');
    elements.messagesArea.innerHTML = '';
    elements.messagesArea.appendChild(elements.emptyStateMsg);
    elements.emptyStateMsg.style.display = 'block';
  });
}

async function performSearch(queryStr) {
  elements.searchResults.innerHTML = '';
  elements.searchResults.classList.remove('hidden');

  // Так как Celestra теперь оффлайн, поиск инициирует создание локального пространства по ID
  const el = document.createElement('div');
  el.className = 'search-result-item';
  el.innerHTML = `
    <img src="https://via.placeholder.com/150/1A1A24/0A84FF?text=${queryStr.charAt(0)}" alt="av">
    <div>
      <div style="font-weight: 500">Локальный узел: ${queryStr}</div>
      <div style="font-size: 12px; color: var(--text-muted)">ID: ${queryStr}</div>
    </div>
  `;
  
  el.addEventListener('click', () => {
    const mockUser = { 
      id: queryStr, 
      nickname: `Узел ${queryStr}`, 
      avatar: `https://via.placeholder.com/150/1A1A24/0A84FF?text=${queryStr.charAt(0)}` 
    };
    elements.searchResults.classList.add('hidden');
    elements.searchInput.value = '';
    saveChatLocally(mockUser);
    openChat(mockUser);
  });
  
  elements.searchResults.appendChild(el);
}

function saveChatLocally(user) {
  let chats = JSON.parse(localStorage.getItem('celestra_chats')) || [];
  const exists = chats.find(c => c.id === user.id);
  if (!exists) {
    chats.unshift(user);
    localStorage.setItem('celestra_chats', JSON.stringify(chats));
    renderMyChats();
  }
}

function renderMyChats() {
  const chats = JSON.parse(localStorage.getItem('celestra_chats')) || [];
  elements.myChatsList.innerHTML = '';
  
  chats.forEach(user => {
    const el = document.createElement('div');
    el.className = 'chat-bubble';
    el.innerHTML = `
      <img src="${user.avatar || 'https://via.placeholder.com/150'}" alt="${user.nickname}">
      <span>${user.nickname}</span>
    `;
    el.addEventListener('click', () => openChat(user));
    elements.myChatsList.appendChild(el);
  });
}

async function openChat(user) {
  activeChatUserId = user.id;
  activeChatId = [myId, user.id].sort().join('_');

  elements.chatHeader.classList.remove('hidden');
  elements.msgInputArea.classList.remove('hidden');
  elements.emptyStateMsg.style.display = 'none';
  elements.messagesArea.innerHTML = '';

  elements.chatAvatar.src = user.avatar;
  elements.chatName.textContent = user.nickname;
  elements.chatId.textContent = `ID: ${user.id}`;

  await loadLocalMessages();
}

async function loadLocalMessages() {
  if (!activeChatId) return;

  const transaction = db.transaction(['messages'], 'readonly');
  const store = transaction.objectStore('messages');
  const index = store.index('chatId');
  const request = index.getAll(activeChatId);

  request.onsuccess = () => {
    const messages = request.result;
    messages.sort((a, b) => a.timestamp - b.timestamp);
    messages.forEach(renderMessage);
  };
}

async function sendTextMessage() {
  const text = elements.msgInput.value.trim();
  if (!text) return;
  elements.msgInput.value = '';
  elements.voiceBtn.classList.remove('hidden');
  elements.sendBtn.classList.add('hidden');
  
  await sendMessage(text, 'text', null);
}

async function sendMessage(text, type, fileUrl) {
  if (!activeChatId) return;

  const messageData = {
    chatId: activeChatId,
    senderId: myId,
    text: text || '',
    type: type, 
    fileUrl: fileUrl || '',
    timestamp: Date.now()
  };

  const transaction = db.transaction(['messages'], 'readwrite');
  const store = transaction.objectStore('messages');
  store.add(messageData);

  renderMessage(messageData);
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = `msg ${msg.senderId === myId ? 'my-msg' : 'their-msg'}`;
  
  if (msg.type === 'text') {
    div.textContent = msg.text;
  } else if (msg.type === 'image') {
    div.innerHTML = `<img src="${msg.fileUrl}" alt="image">`;
  } else if (msg.type === 'audio') {
    div.innerHTML = `<audio controls src="${msg.fileUrl}"></audio>`;
  }

  elements.messagesArea.appendChild(div);
  elements.messagesArea.scrollTop = elements.messagesArea.scrollHeight;
}

let mediaRecorder;
let audioChunks = [];

async function setupVoiceRecording() {
  let isRecording = false;

  elements.voiceBtn.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const base64Audio = await fileToBase64(audioBlob);
          sendMessage(null, 'audio', base64Audio);
        };

        mediaRecorder.start();
        isRecording = true;
        elements.voiceBtn.classList.add('recording');
      } catch (err) {
        alert("Доступ к микрофону запрещен или не поддерживается.");
      }
    } else {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      isRecording = false;
      elements.voiceBtn.classList.remove('recording');
    }
  });
}

function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('SW зарегистрирован для Celestra:', registration.scope);
        })
        .catch(err => console.error('Ошибка SW:', err));
    });
  }
}

init();
