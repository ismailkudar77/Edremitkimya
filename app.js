// Firebase bağlantısı — GitHub Pages + Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCpNX9XDeA96Rx7nhI4yHR7Rkr6tmreKZM",
  authDomain: "edremit-kimya-oryantiring.firebaseapp.com",
  projectId: "edremit-kimya-oryantiring",
  storageBucket: "edremit-kimya-oryantiring.firebasestorage.app",
  messagingSenderId: "862489744332",
  appId: "1:862489744332:web:f29fbef4b057070f868369",
  measurementId: "G-4FQ4SZB4Q0"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const STATIONS = [
  {id:1, code:'EDR-KIM-01', internalName:'Fernur Sözen MTAL', theme:'Kimya Her Yerde'},
  {id:2, code:'EDR-KIM-02', internalName:'Edremit İlçe Halk Kütüphanesi', theme:'Atomların Hikâyesi'},
  {id:3, code:'EDR-KIM-03', internalName:'Faruk Serpil Parkı', theme:'Element Avcısı'},
  {id:4, code:'EDR-KIM-04', internalName:'Ayşe Sıdıka Erke Etnografya Müzesi', theme:'Maddenin Geçmişi'},
  {id:5, code:'EDR-KIM-05', internalName:'Edremit MYO', theme:'Zeytinin Kimyası'},
  {id:6, code:'EDR-KIM-06', internalName:'Sarıkız Meydanı', theme:'Denizin Kimyasal Şifresi'},
  {id:7, code:'EDR-KIM-07', internalName:'Zeytinyağı Analiz Laboratuvarı', theme:'Gerçek Hayatta Kimyasal Analiz'},
  {id:8, code:'EDR-KIM-08', internalName:'Arıtma Tesisi / Aday İstasyon', theme:'Suyun Kimyası'},
  {id:9, code:'EDR-KIM-09', internalName:'Şehit Hamdibey Meydanı', theme:'Kimya Büyük Final Şifresi'},
  {id:10, code:'EDR-KIM-10', internalName:'Fernur Sözen MTAL', theme:'Final'}
];

const DEFAULT_STATE = {
  team: null,
  completed: [],
  evidence: [],
  wrongAttempts: 0,
  stationProgress: {
    1: {questionSolved:false, puzzleSolved:false}
  }
};

let state = normalizeState(JSON.parse(localStorage.getItem('edremitKimyaState') || 'null'));
// Eski prototipten kalan yerel takım kaydı varsa yeni Firebase kayıt ekranına geçir.
if(state.team && !state.team.id){
  state = normalizeState(null);
  localStorage.setItem('edremitKimyaState', JSON.stringify(state));
}
let mediaStream = null;
let scanTimer = null;
let deferredPrompt = null;
let selectedTile = null;
let firebaseReady = false;
let syncTimer = null;
let pendingQrCode = null;

const $ = id => document.getElementById(id);
const views = [...document.querySelectorAll('.view')];

function normalizeState(raw){
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    ...DEFAULT_STATE,
    ...s,
    completed: Array.isArray(s.completed) ? s.completed : [],
    evidence: Array.isArray(s.evidence) ? s.evidence : [],
    stationProgress: {
      ...DEFAULT_STATE.stationProgress,
      ...(s.stationProgress || {}),
      1: {...DEFAULT_STATE.stationProgress[1], ...(s.stationProgress?.[1] || {})}
    }
  };
}

function save({cloud=true} = {}){
  localStorage.setItem('edremitKimyaState', JSON.stringify(state));
  if(cloud && state.team?.id) scheduleCloudSync();
}

function scheduleCloudSync(){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncTeamState, 450);
}

function setCloudStatus(text, mode='normal'){
  const el = $('cloudStatus');
  if(!el) return;
  el.textContent = text;
  el.classList.toggle('statusDone', mode === 'ok');
  el.classList.toggle('errorText', mode === 'error');
}

async function initFirebase(){
  try{
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    if(!auth.currentUser) await auth.signInAnonymously();
    firebaseReady = true;
    setCloudStatus('☁️ Çevrim içi kayıt hazır', 'ok');

    if(state.team?.id){
      await loadTeamFromCloud();
    }
    handleQrFromUrl();
  }catch(err){
    console.error('Firebase başlatılamadı:', err);
    setCloudStatus('⚠️ Bulut bağlantısı kurulamadı', 'error');
    handleQrFromUrl();
  }
}

async function loadTeamFromCloud(){
  if(!firebaseReady || !state.team?.id) return;
  try{
    const snap = await db.collection('teams').doc(state.team.id).get();
    if(!snap.exists) return;
    const data = snap.data();
    state = normalizeState({
      ...state,
      team: {
        ...state.team,
        name: data.name || state.team.name,
        code: data.teamCode || state.team.code,
        members: data.members || state.team.members
      },
      completed: data.completed || [],
      evidence: data.evidence || [],
      wrongAttempts: data.wrongAttempts || 0,
      stationProgress: data.stationProgress || state.stationProgress
    });
    save({cloud:false});
    render();
    setCloudStatus('☁️ İlerleme eşitlendi', 'ok');
  }catch(err){
    console.error('Takım verisi okunamadı:', err);
    setCloudStatus('⚠️ Yerel kayıtla devam ediliyor', 'error');
  }
}

async function syncTeamState(){
  if(!firebaseReady || !state.team?.id || !auth.currentUser) return;
  try{
    setCloudStatus('☁️ Kaydediliyor…');
    await db.collection('teams').doc(state.team.id).update({
      completed: state.completed,
      evidence: state.evidence,
      wrongAttempts: state.wrongAttempts || 0,
      stationProgress: state.stationProgress || {},
      currentStation: Math.min(state.completed.length + 1, STATIONS.length),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    setCloudStatus('☁️ İlerleme kaydedildi', 'ok');
  }catch(err){
    console.error('Bulut kaydı başarısız:', err);
    setCloudStatus('⚠️ Bulut kaydı bekliyor', 'error');
  }
}

function showView(id){
  views.forEach(v => v.classList.add('hidden'));
  $(id).classList.remove('hidden');
  window.scrollTo({top:0, behavior:'smooth'});
  if(id !== 'scannerView') stopCamera();
}

function fullName(member){
  if(typeof member === 'string') return member;
  return `${member?.firstName || ''} ${member?.lastName || ''}`.trim() || 'Öğrenci';
}

function render(){
  const hasTeam = !!state.team;
  $('teamSetup').classList.toggle('hidden', hasTeam);
  $('dashboard').classList.toggle('hidden', !hasTeam);
  if(hasTeam){
    $('dashTeamName').textContent = state.team.name;
    $('teamCodeBadge').textContent = `Grup kodu: ${state.team.code || state.team.id}`;
    const c = state.completed.length;
    $('progressBadge').textContent = `${c} / ${STATIONS.length}`;
    $('progressBar').style.width = `${(c / STATIONS.length) * 100}%`;
    renderRoles();
  }
  renderStations();
  renderEvidence();
  renderAchievement();
}

function collectMembers(){
  return [1,2,3].map(i => ({
    firstName: $(`m${i}First`).value.trim(),
    lastName: $(`m${i}Last`).value.trim(),
    className: $(`m${i}Class`).value.trim().toUpperCase(),
    number: $(`m${i}No`).value.trim()
  }));
}

function validateMembers(teamName, members){
  if(!teamName) return 'Takım adı gerekli.';
  for(const [idx,m] of members.entries()){
    if(!m.firstName || !m.lastName || !m.className || !m.number){
      return `${idx+1}. öğrencinin ad, soyad, sınıf ve numara bilgilerini tamamlayın.`;
    }
    if(!/^\d+$/.test(m.number)) return `${idx+1}. öğrencinin okul numarası yalnızca rakamlardan oluşmalı.`;
  }
  const localKeys = members.map(m => `${normalizeClass(m.className)}|${m.number}`);
  if(new Set(localKeys).size !== localKeys.length) return 'Aynı öğrenci aynı gruba iki kez eklenemez.';
  return '';
}

function normalizeClass(value){
  return value.toLocaleUpperCase('tr-TR').replace(/\s+/g,'').replace(/[^0-9A-ZÇĞİÖŞÜ]/g,'');
}

async function studentKey(member){
  const raw = `${normalizeClass(member.className)}|${member.number}`;
  const bytes = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
}

function makeTeamCode(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  crypto.getRandomValues(new Uint32Array(8)).forEach(n => out += alphabet[n % alphabet.length]);
  return out;
}

async function saveTeam(){
  const btn = $('saveTeamBtn');
  const errorEl = $('teamError');
  errorEl.classList.add('hidden');
  const teamName = $('teamName').value.trim();
  const members = collectMembers();
  const validation = validateMembers(teamName, members);
  if(validation){
    errorEl.textContent = validation;
    errorEl.classList.remove('hidden');
    return;
  }
  if(!firebaseReady || !auth.currentUser){
    errorEl.textContent = 'İnternet/Firebase bağlantısı henüz hazır değil. Birkaç saniye sonra tekrar deneyin.';
    errorEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Kontrol ediliyor…';

  try{
    const keys = await Promise.all(members.map(studentKey));
    const refs = keys.map(key => db.collection('students').doc(key));
    const snapshots = await Promise.all(refs.map(ref => ref.get()));
    const duplicateIndex = snapshots.findIndex(s => s.exists);
    if(duplicateIndex >= 0){
      const m = members[duplicateIndex];
      throw new Error(`${fullName(m)} (${m.className} / ${m.number}) daha önce başka bir gruba kaydedilmiş.`);
    }

    const teamCode = makeTeamCode();
    const teamRef = db.collection('teams').doc(teamCode);

    const batch = db.batch();
    batch.set(teamRef, {
      teamCode,
      name: teamName,
      members,
      ownerUid: auth.currentUser.uid,
      completed: [],
      evidence: [],
      wrongAttempts: 0,
      stationProgress: {1:{questionSolved:false,puzzleSolved:false}},
      currentStation: 1,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    refs.forEach(ref => batch.set(ref, {
      teamId: teamCode,
      ownerUid: auth.currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }));

    await batch.commit();

    state = normalizeState({
      team: {id:teamCode, code:teamCode, name:teamName, members},
      completed: [],
      evidence: [],
      wrongAttempts: 0,
      stationProgress: {1:{questionSolved:false,puzzleSolved:false}}
    });
    save({cloud:false});
    render();
    setCloudStatus('☁️ Takım kaydı oluşturuldu', 'ok');
  }catch(err){
    console.error('Takım oluşturulamadı:', err);
    const message = err?.message?.includes('permission')
      ? 'Kayıt oluşturulamadı. Firestore güvenlik kurallarının yayınlandığını kontrol edin.'
      : (err?.message || 'Takım oluşturulamadı. Lütfen tekrar deneyin.');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }finally{
    btn.disabled = false;
    btn.textContent = 'Takımı oluştur';
  }
}

function roleNames(stationNo=1){
  const m = state.team?.members || [
    {firstName:'Öğrenci',lastName:'1'},
    {firstName:'Öğrenci',lastName:'2'},
    {firstName:'Öğrenci',lastName:'3'}
  ];
  const names = m.map(fullName);
  const shift = (stationNo - 1) % 3;
  const arr = [names[(0+shift)%3], names[(1+shift)%3], names[(2+shift)%3]];
  return {chemist:arr[0], navigator:arr[1], documenter:arr[2]};
}

function renderRoles(){
  const next = Math.min(state.completed.length + 1, STATIONS.length);
  const r = roleNames(next);
  $('roleList').innerHTML = `<div class="role">🧪 <b>Kimyager:</b> ${escapeHtml(r.chemist)}</div><div class="role">🧭 <b>Navigatör:</b> ${escapeHtml(r.navigator)}</div><div class="role">📸 <b>Belgeleyici:</b> ${escapeHtml(r.documenter)}</div>`;
}

function escapeHtml(text){
  return String(text).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function renderStations(){
  $('stationList').innerHTML = STATIONS.map(s => {
    const done = state.completed.includes(s.id);
    const unlocked = s.id === 1 || state.completed.includes(s.id - 1);
    const icon = done ? '✅' : unlocked ? '🔓' : '🔒';
    const title = done ? `İstasyon ${String(s.id).padStart(2,'0')}` : unlocked ? `İstasyon ${String(s.id).padStart(2,'0')}` : '???';
    const status = done ? 'Tamamlandı' : unlocked ? 'Erişilebilir — QR kodunu bulun' : 'Henüz açılmadı';
    return `<div class="stationItem"><b>${icon} ${title}</b><br><span class="${done?'statusDone':'statusLocked'}">${status}</span>${done ? `<div class="muted small">${escapeHtml(s.theme)}</div>` : ''}</div>`;
  }).join('');
}

function renderEvidence(){
  $('evidenceList').innerHTML = STATIONS.map(s => {
    const done = state.evidence.includes(s.id);
    return `<div class="evidenceItem"><b>${done?'📸✅':'📷'} İstasyon ${String(s.id).padStart(2,'0')}</b><br><span class="${done?'statusDone':'statusLocked'}">${done?'Fotoğraf görevi işaretlendi':'Henüz tamamlanmadı'}</span></div>`;
  }).join('');
}

function renderAchievement(){
  const c = state.completed.length;
  if(c === STATIONS.length){
    $('titleStatus').textContent = 'Edremit Kimya Kâşifi';
    $('achievementText').textContent = 'Parkurun tüm istasyonlarını tamamladınız.';
  }else{
    $('titleStatus').textContent = 'Edremit Kimya Kâşifi Adayı';
    $('achievementText').textContent = `${c}/${STATIONS.length} istasyon tamamlandı. Unvan için parkurun tamamını bitirin.`;
  }
}

function openStationByCode(raw){
  const code = (raw || '').trim().toUpperCase();
  const s = STATIONS.find(x => x.code === code);
  if(!s){ showScanError('Bu kod parkura ait görünmüyor.'); return; }
  if(!state.team){
    pendingQrCode = code;
    showView('homeView');
    $('teamError').textContent = 'Önce takım kaydını tamamlayın. Kayıttan sonra bu QR kod tekrar açılabilir.';
    $('teamError').classList.remove('hidden');
    return;
  }
  const unlocked = s.id === 1 || state.completed.includes(s.id - 1);
  if(!unlocked){ showScanError(`İstasyon ${String(s.id).padStart(2,'0')} henüz kilitli. Önce önceki görevi tamamlayın.`); return; }

  stopCamera();
  showView('stationView');
  document.querySelectorAll('.station').forEach(x => x.classList.add('hidden'));
  if(s.id === 1){
    $('station01').classList.remove('hidden');
    renderStation1();
  }else{
    $('stationPlaceholder').classList.remove('hidden');
    $('placeholderTitle').textContent = `İstasyon ${String(s.id).padStart(2,'0')}`;
  }
}

function showScanError(msg){
  $('scanError').textContent = msg;
  $('scanError').classList.remove('hidden');
}

function renderStation1(){
  const r = roleNames(1);
  $('stationRoles').innerHTML = `<div class="role">🧪 <b>Kimyager:</b> ${escapeHtml(r.chemist)}</div><div class="role">🧭 <b>Navigatör:</b> ${escapeHtml(r.navigator)}</div><div class="role">📸 <b>Belgeleyici:</b> ${escapeHtml(r.documenter)}</div>`;
  ensurePreview();

  if(state.stationProgress?.[1]?.questionSolved){
    $('answerFeedback').innerHTML = '<div class="successBox">✅ <b>Kimya kilidi daha önce açıldı.</b> Puzzle bölümünden devam edebilirsiniz.</div>';
    $('puzzleCard').classList.remove('hidden');
    initPuzzle(Boolean(state.stationProgress?.[1]?.puzzleSolved));
  }
}

function bindQuestion(){
  document.querySelectorAll('#s1Question .answer').forEach(btn => {
    btn.addEventListener('click', () => {
      if(state.stationProgress?.[1]?.questionSolved) return;
      const ok = btn.dataset.correct === 'true';
      if(ok){
        btn.classList.add('good');
        $('answerFeedback').innerHTML = '<div class="successBox">✅ <b>Kimya kilidi açıldı.</b> Kimya; maddelerin yapısını, özelliklerini ve geçirdiği değişimleri inceler.</div>';
        state.stationProgress[1].questionSolved = true;
        save();
        setTimeout(() => {
          $('puzzleCard').classList.remove('hidden');
          initPuzzle(false);
          $('puzzleCard').scrollIntoView({behavior:'smooth'});
        }, 400);
      }else{
        state.wrongAttempts = (state.wrongAttempts || 0) + 1;
        save();
        btn.classList.add('bad');
        const hint = state.wrongAttempts === 1
          ? 'Kimya yalnızca laboratuvardaki tepkimeleri değil; maddelerin yapısını, özelliklerini ve değişimlerini de inceler.'
          : 'Paslanma, temizlik maddesi ve plastik malzeme üçü de farklı yönlerden kimyayla ilişkilidir.';
        $('answerFeedback').innerHTML = `<div class="hintBox">🔒 Hedef henüz açılmadı.<br>💡 ${hint}</div>`;
      }
    });
  });
}

const mapSVG=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900"><defs><linearGradient id="bg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f7f0e4"/><stop offset="1" stop-color="#f3ead9"/></linearGradient></defs><rect width="900" height="900" fill="url(#bg)"/><g fill="#cfe7c9"><circle cx="150" cy="230" r="64"/><circle cx="660" cy="730" r="58"/><circle cx="790" cy="140" r="44"/></g><g stroke="#cebfa8" stroke-width="40" fill="none" stroke-linecap="round"><path d="M30 150 C240 120 490 200 860 125"/><path d="M55 370 C260 330 540 390 865 340"/><path d="M35 610 C270 555 520 650 860 585"/><path d="M205 35 C245 250 245 570 215 870"/><path d="M505 35 C505 255 550 570 535 870"/><path d="M760 35 C735 245 755 575 790 870"/></g><g stroke="#fff" stroke-width="11" fill="none" stroke-linecap="round"><path d="M30 150 C240 120 490 200 860 125"/><path d="M55 370 C260 330 540 390 865 340"/><path d="M35 610 C270 555 520 650 860 585"/><path d="M205 35 C245 250 245 570 215 870"/><path d="M505 35 C505 255 550 570 535 870"/><path d="M760 35 C735 245 755 575 790 870"/></g><g font-family="Arial" fill="#2d434d"><text x="65" y="110" font-size="34" font-weight="700">Cennetayağı Mah.</text><text x="548" y="300" font-size="30" transform="rotate(-4 548 300)">İstasyon Cd.</text><text x="82" y="738" font-size="27">6021 Sk.</text></g><g transform="translate(95 650)"><rect width="250" height="130" rx="22" fill="#0b4f6c"/><text x="125" y="48" text-anchor="middle" font-family="Arial" font-size="32" fill="#fff" font-weight="700">OKUL</text><text x="125" y="84" text-anchor="middle" font-family="Arial" font-size="22" fill="#d7f1ff">Başlangıç</text><text x="125" y="109" text-anchor="middle" font-family="Arial" font-size="18" fill="#d7f1ff">Fernur Sözen MTAL</text></g><path d="M345 690 C460 630 540 505 655 385" stroke="#148255" stroke-width="14" fill="none" stroke-dasharray="22 16"/><g transform="translate(648 238)"><path d="M72 0C32 0 0 32 0 72c0 57 72 136 72 136s72-79 72-136C144 32 112 0 72 0z" fill="#e3454f"/><circle cx="72" cy="70" r="26" fill="white"/><text x="72" y="80" text-anchor="middle" font-family="Arial" font-size="36" font-weight="700" fill="#e3454f">2</text></g><g transform="translate(572 115)"><rect width="210" height="84" rx="16" fill="#ffffffcc" stroke="#d9d9d9"/><text x="105" y="34" text-anchor="middle" font-family="Arial" font-size="24" font-weight="700" fill="#21343d">HEDEF 02</text><text x="105" y="61" text-anchor="middle" font-family="Arial" font-size="18" fill="#415962">İstasyon Caddesi</text></g></svg>`;

const mapURI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(mapSVG);
let puzzleOrder = [...Array(9).keys()];

function ensurePreview(){
  const c = $('mapPreview');
  if(c.childElementCount === 0){
    const img = document.createElement('img');
    img.src = mapURI;
    img.alt = 'Harita önizleme';
    c.appendChild(img);
  }
}

function makeTile(idx){
  const div = document.createElement('div');
  div.className = 'tile';
  div.dataset.correct = idx;
  const img = document.createElement('img');
  const x = (idx % 3) * 300, y = Math.floor(idx / 3) * 300;
  const tileSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="${x} ${y} 300 300"><image href="${mapURI}" width="900" height="900"/></svg>`;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tileSVG);
  const num = document.createElement('div');
  num.className = 'tileNum';
  num.textContent = idx + 1;
  div.appendChild(img);
  div.appendChild(num);
  div.addEventListener('click', () => tileClick(div));
  return div;
}

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function initPuzzle(solved=false){
  const board = $('puzzle');
  board.innerHTML = '';
  board.classList.toggle('puzzleSolved', solved);
  selectedTile = null;
  puzzleOrder = [...Array(9).keys()];
  if(!solved){
    shuffle(puzzleOrder);
    if(puzzleOrder.every((v,i)=>v===i)) [puzzleOrder[0], puzzleOrder[1]] = [puzzleOrder[1], puzzleOrder[0]];
  }
  puzzleOrder.forEach(i => board.appendChild(makeTile(i)));
  $('target02').classList.toggle('hidden', !solved);
  $('photoMission').classList.toggle('hidden', !solved);
  $('puzzleHintBox').classList.add('hidden');
  $('shuffleBtn').disabled = solved;
  if(solved) $('target02').classList.remove('hidden');
}

function tileClick(el){
  if(state.stationProgress?.[1]?.puzzleSolved) return;
  if(!selectedTile){ selectedTile = el; el.classList.add('selected'); return; }
  if(selectedTile === el){ el.classList.remove('selected'); selectedTile = null; return; }
  const board = $('puzzle'), nodes = [...board.children], a = nodes.indexOf(selectedTile), b = nodes.indexOf(el);
  if(a < b){
    board.insertBefore(el, selectedTile);
    board.insertBefore(selectedTile, nodes[b+1] || null);
  }else{
    board.insertBefore(selectedTile, el);
    board.insertBefore(el, nodes[a+1] || null);
  }
  selectedTile.classList.remove('selected');
  selectedTile = null;
  checkPuzzle();
}

function checkPuzzle(){
  const ok = [...$('puzzle').children].every((el,i) => Number(el.dataset.correct) === i);
  if(ok){
    $('puzzle').classList.add('puzzleSolved');
    $('target02').classList.remove('hidden');
    $('photoMission').classList.remove('hidden');
    $('shuffleBtn').disabled = true;
    state.stationProgress[1].puzzleSolved = true;
    save();
    setTimeout(() => $('target02').scrollIntoView({behavior:'smooth', block:'start'}), 180);
  }
}

function previewPhoto(file){
  if(!file) return;
  const url = URL.createObjectURL(file);
  $('photoPreview').innerHTML = `<img src="${url}" alt="Fotoğraf önizleme">`;
  $('photoPreview').classList.remove('hidden');
}

function completeStation1(){
  if(!$('photoDone').checked){
    $('completeError').classList.remove('hidden');
    return;
  }
  if(!state.stationProgress?.[1]?.puzzleSolved){
    $('completeError').textContent = 'Önce puzzle görevini tamamlayın.';
    $('completeError').classList.remove('hidden');
    return;
  }
  $('completeError').classList.add('hidden');
  if(!state.completed.includes(1)) state.completed.push(1);
  if(!state.evidence.includes(1)) state.evidence.push(1);
  save();
  render();
  alert('🏁 İstasyon 01 tamamlandı! Bir sonraki istasyonun QR kodu artık erişilebilir.');
  showView('homeView');
}

async function startCamera(){
  $('scanError').classList.add('hidden');
  if(!navigator.mediaDevices?.getUserMedia){
    $('cameraNote').textContent = 'Bu tarayıcı kamera erişimini desteklemiyor. Manuel kod girişini kullanın.';
    return;
  }
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
    $('video').srcObject = mediaStream;
    await $('video').play();
    $('startCameraBtn').classList.add('hidden');
    $('stopCameraBtn').classList.remove('hidden');
    if('BarcodeDetector' in window){
      const detector = new BarcodeDetector({formats:['qr_code']});
      $('cameraNote').textContent = 'Kamera açık. QR kodu çerçeveye getirin.';
      scanTimer = setInterval(async () => {
        try{
          const codes = await detector.detect($('video'));
          if(codes?.length) openStationByCode(extractCode(codes[0].rawValue));
        }catch(e){}
      }, 700);
    }else{
      $('cameraNote').textContent = 'Tarayıcı otomatik QR algılamıyor. Kodu manuel girebilirsiniz.';
    }
  }catch(e){
    $('cameraNote').textContent = 'Kamera izni alınamadı. Siteyi GitHub Pages üzerinden HTTPS ile açtığınızdan emin olun.';
  }
}

function stopCamera(){
  if(scanTimer){ clearInterval(scanTimer); scanTimer = null; }
  if(mediaStream){ mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if($('video')) $('video').srcObject = null;
  $('startCameraBtn')?.classList.remove('hidden');
  $('stopCameraBtn')?.classList.add('hidden');
}

function extractCode(raw){
  const value = String(raw || '').trim();
  try{
    const url = new URL(value);
    return url.searchParams.get('code') || value;
  }catch(e){
    return value;
  }
}

function handleQrFromUrl(){
  const code = new URLSearchParams(location.search).get('code');
  if(!code) return;
  if(state.team) openStationByCode(code);
  else pendingQrCode = code;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('installBtn').classList.remove('hidden');
});

$('installBtn').addEventListener('click', async () => {
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('installBtn').classList.add('hidden');
});

$('saveTeamBtn').addEventListener('click', async () => {
  await saveTeam();
  if(state.team && pendingQrCode){
    const code = pendingQrCode;
    pendingQrCode = null;
    setTimeout(() => openStationByCode(code), 250);
  }
});
$('scanBtn').addEventListener('click', () => showView('scannerView'));
$('routeBtn').addEventListener('click', () => showView('routeView'));
$('evidenceBtn').addEventListener('click', () => showView('evidenceView'));
$('achievementsBtn').addEventListener('click', () => showView('achievementsView'));
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => showView('homeView')));
$('startCameraBtn').addEventListener('click', startCamera);
$('stopCameraBtn').addEventListener('click', stopCamera);
$('manualOpenBtn').addEventListener('click', () => openStationByCode(extractCode($('manualCode').value)));
$('shuffleBtn').addEventListener('click', () => initPuzzle(false));
$('hintBtn').addEventListener('click', () => $('puzzleHintBox').classList.toggle('hidden'));
$('togglePreviewBtn').addEventListener('click', () => $('mapPreview').classList.toggle('hidden'));
$('photoInput').addEventListener('change', e => previewPhoto(e.target.files[0]));
$('completeStation1Btn').addEventListener('click', completeStation1);

bindQuestion();
render();
initFirebase();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
