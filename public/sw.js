// 폰 설치형 앱(PWA)용 서비스 워커.
// 인터넷이 될 때는 항상 최신 파일을 받고, 인터넷이 안 될 때만 마지막으로 받아 둔 파일을 보여준다.
// (예전 파일과 새 파일이 섞여 화면이 깨지는 일을 막기 위해 "네트워크 우선" 방식을 쓴다.)
const CACHE = 'hordelife-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'auth.js', 'members.js', 'config.js', 'manifest.webmanifest', 'img/forever-logo.png', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // 같은 주소의 GET 요청만 다룬다. (글꼴·외부 이미지 등은 브라우저에 맡김)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
  );
});
