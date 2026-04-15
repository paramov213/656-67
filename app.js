import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, doc, setDoc, getDoc, collection, query, where, getDocs, 
  onSnapshot, addDoc, serverTimestamp, orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getStorage, ref, uploadBytesResumable, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// !!! ВСТАВЬ СВОЙ КОНФИГ СЮДА !!!
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "твое-приложение.firebaseapp.com",
  projectId: "твое-приложение",
  storageBucket: "твое-приложение.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Глобальные переменные
let myId = localStorage.getItem('myDeviceId');
let myProfile = JSON.parse(localStorage.getItem('myProfile')) || { nickname: '', avatar: 'https://via.placeholder.com/150/333333/FFFFFF?text=?' };
let activeChatUserId = null;
let activeChatId = null;
let unsubscribeMessages = null;

// DOM Элементы
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

// Инициализация
async function init() {
  if (!myId) {
    myId = Math.random().toString(36).substring(2, 8).toUpperCase();
    localStorage.setItem('myDeviceId', myId);
  }
  
  elements.myIdDisplay.textContent = `ID: ${myId}`;
  elements.myNickname.value = myProfile.nickname;
  elements.myAvatar.src = myProfile.avatar;

  await syncProfileToDb();
  setupEventListeners();
  renderMyChats();
  initServiceWorker();
}

// Синхронизация профиля с Firestore
async function syncProfileToDb() {
  try {
    await setDoc(doc(db, "users", myId), {
      id: myId,
      nickname: myProfile.nickname || `User-${myId}`,
      avatar: myProfile.avatar,
      lastActive: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error("Ошибка сохранения профиля:", e);
  }
}

// Слушатели событий
function setupEventListeners() {
  // Обновление ника
  elements.myNickname.addEventListener('blur', () => {
    myProfile.nickname = elements.myNickname.value;
    localStorage.setItem('myProfile', JSON.stringify(myProfile));
    syncProfileToDb();
  });

  // Загрузка аватарки
  elements.avatarBtn.addEventListener('click', () => elements.avatarUpload.click());
  elements.avatarUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = await uploadFile(file, `avatars/${myId}_${Date.now()}`);
      if (url) {
        myProfile.avatar = url;
        elements.myAvatar.src = url;
        localStorage.setItem('myProfile', JSON.stringify(myProfile));
        syncProfileToDb();
      }
    }
  });

  // Живой поиск
  let searchTimeout;
  elements.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const queryStr = e.target.value.trim().toUpperCase();
    
    if (queryStr.length < 2) {
      elements.searchResults.classList.add('hidden');
      return;
    }

    searchTimeout = setTimeout(() => performSearch(queryStr), 500);
  });

  // Закрытие поиска при клике вне
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-section')) {
      elements.searchResults.classList.add('hidden');
    }
  });

  // Логика ввода сообщений (переключение микрофон/отправить)
  elements.msgInput.addEventListener('input', (e) => {
    if (e.target.value.trim().length > 0) {
      elements.voiceBtn.classList.add('hidden');
      elements.sendBtn.classList.remove('hidden');
    } else {
      elements.voiceBtn.classList.remove('hidden');
      elements.sendBtn.classList.add('hidden');
    }
  });

  // Отправка текста
  elements.sendBtn.addEventListener('click', () => sendTextMessage());
  elements.msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendTextMessage();
  });

  // Отправка картинки
  elements.attachBtn.addEventListener('click', () => elements.imageUpload.click());
  elements.imageUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = await uploadFile(file, `chats/${activeChatId}/images/${Date.now()}`);
      if (url) sendMessage(null, 'image', url);
    }
  });

  // Голосовые сообщения
  setupVoiceRecording();

  // Закрыть чат
  elements.closeChatBtn.addEventListener('click', () => {
    activeChatUserId = null;
    activeChatId = null;
    if (unsubscribeMessages) unsubscribeMessages();
    elements.chatHeader.classList.add('hidden');
    elements.msgInputArea.classList.add('hidden');
    elements.messagesArea.innerHTML = '';
    elements.messagesArea.appendChild(elements.emptyStateMsg);
    elements.emptyStateMsg.style.display = 'block';
  });
}

// Функция поиска
async function performSearch(queryStr) {
  try {
    elements.searchResults.innerHTML = '<div class="search-result-item" style="justify-content:center;">Загрузка...</div>';
    elements.searchResults.classList.remove('hidden');

    // Поскольку мы ищем по ID (строке), используем >= и <= для поиска по префиксу
    const q = query(
      collection(db, "users"),
      where("id", ">=", queryStr),
      where("id", "<=", queryStr + '\uf8ff')
    );
    const querySnapshot = await getDocs(q);
    
    elements.searchResults.innerHTML = '';
    
    if (querySnapshot.empty) {
      elements.searchResults.innerHTML = '<div class="search-result-item">Ничего не найдено</div>';
      return;
    }

    querySnapshot.forEach((docSnap) => {
      const user = docSnap.data();
      if (user.id === myId) return; // Не показываем себя

      const el = document.createElement('div');
      el.className = 'search-result-item';
      el.innerHTML = `
        <img src="${user.avatar || 'https://via.placeholder.com/150'}" alt="av">
        <div>
          <div style="font-weight: 500">${user.nickname}</div>
          <div style="font-size: 12px; color: var(--text-muted)">ID: ${user.id}</div>
        </div>
      `;
      el.addEventListener('click', () => {
        elements.searchResults.classList.add('hidden');
        elements.searchInput.value = '';
        saveChatLocally(user);
        openChat(user);
      });
      elements.searchResults.appendChild(el);
    });
    
    if (elements.searchResults.innerHTML === '') {
      elements.searchResults.innerHTML = '<div class="search-result-item">Ничего не найдено</div>';
    }

  } catch (error) {
    console.error("Search error:", error);
  }
}

// Сохранение контакта и рендер ленты
function saveChatLocally(user) {
  let chats = JSON.parse(localStorage.getItem('my_chats')) || [];
  const exists = chats.find(c => c.id === user.id);
  if (!exists) {
    chats.unshift(user);
    localStorage.setItem('my_chats', JSON.stringify(chats));
    renderMyChats();
  }
}

function renderMyChats() {
  const chats = JSON.parse(localStorage.getItem('my_chats')) || [];
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

// Открытие переписки
async function openChat(user) {
  activeChatUserId = user.id;
  
  // Генерируем уникальный ID чата для двоих (сортируем ID по алфавиту)
  activeChatId = [myId, user.id].sort().join('_');

  elements.chatHeader.classList.remove('hidden');
  elements.msgInputArea.classList.remove('hidden');
  elements.emptyStateMsg.style.display = 'none';
  elements.messagesArea.innerHTML = '';

  elements.chatAvatar.src = user.avatar;
  elements.chatName.textContent = user.nickname;
  elements.chatId.textContent = `ID: ${user.id}`;

  if (unsubscribeMessages) unsubscribeMessages();

  // Слушаем сообщения в реальном времени
  const q = query(collection(db, `chats/${activeChatId}/messages`), orderBy("timestamp", "asc"));
  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        renderMessage(change.doc.data());
      }
    });
  });
}

// Отправка сообщений
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

  try {
    await addDoc(collection(db, `chats/${activeChatId}/messages`), {
      senderId: myId,
      text: text || '',
      type: type, // 'text', 'image', 'audio'
      fileUrl: fileUrl || '',
      timestamp: serverTimestamp()
    });
  } catch (error) {
    console.error("Ошибка отправки:", error);
  }
}

// Отрисовка сообщения
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

// Загрузка файлов (Картинки/Голосовые/Аватары)
async function uploadFile(file, path) {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed', 
      null, 
      (error) => {
        console.error("Upload error:", error);
        reject(error);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(downloadURL);
      }
    );
  });
}

// Голосовые сообщения (MediaRecorder)
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
          const file = new File([audioBlob], "voice.webm", { type: 'audio/webm' });
          const url = await uploadFile(file, `chats/${activeChatId}/audio/${Date.now()}.webm`);
          if (url) sendMessage(null, 'audio', url);
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

// Инициализация PWA Service Worker
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('SW зарегистрирован:', registration.scope);
          // Запрос прав на уведомления (Android 15)
          if ('Notification' in window && Notification.permission !== 'granted') {
             Notification.requestPermission();
          }
        })
        .catch(err => console.error('Ошибка SW:', err));
    });
  }
}

// Запуск
init();