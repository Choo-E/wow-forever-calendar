// 영어 → 한국어 자동 번역 (API 키가 필요 없는 무료 서비스 사용)
//   1순위: Google 번역의 비공식 공개 주소 (품질 좋음, 하지만 언제든 막힐 수 있음)
//   2순위: MyMemory 무료 API (하루 사용량 제한이 있음)
// 둘 다 실패하면 null 을 돌려주고, 화면은 영어 원문을 그대로 보여준다.
// 나중에 Claude API 등으로 바꾸려면 translateText 함수만 바꾸면 된다.

const UA = 'Mozilla/5.0 (compatible; WoWForeverCalendar/1.0)';

// 번역기가 자주 어색하게 옮기는 와우 용어를 바로잡는 사전 (번역 결과에서 치환)
const GLOSSARY = [
  [/핫 ?픽스/g, '핫픽스'],
  [/레이드/g, '공격대'],
  [/던전/g, '던전'],
  [/드루이드/g, '드루이드'],
  [/팔라딘/g, '성기사'],
  [/주술사/g, '주술사'],
  [/흑마법사/g, '흑마법사'],
  [/도적/g, '도적'],
  [/전사/g, '전사'],
  [/월드 오브 워크래프트: ?포에버/g, 'WoW: 포에버'],
  [/영원히/g, '포에버'],
  [/WoW: ?Forever/gi, 'WoW: 포에버'],
  [/Forever Launch/gi, '포에버 출시'],
  [/\bForever\b/g, '포에버'],
  [/\bLaunch\b/g, '출시'],
  [/\bBlizzard\b/g, '블리자드'],
  [/하스스톤/g, '귀환석'], // 와우 기사 속 Hearthstone 은 게임 아이템(귀환석)
];

function fixTerms(text) {
  return GLOSSARY.reduce((t, [from, to]) => t.replace(from, to), text);
}

async function viaGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`google ${res.status}`);
  const json = await res.json();
  const out = (json?.[0] || []).map((seg) => seg?.[0] || '').join('');
  if (!out.trim()) throw new Error('google 빈 응답');
  return out;
}

async function viaMyMemory(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=en|ko`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`mymemory ${res.status}`);
  const json = await res.json();
  const out = json?.responseData?.translatedText || '';
  if (json?.responseStatus !== 200 || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) throw new Error('mymemory 거절');
  return out;
}

export async function translateText(text) {
  const src = (text || '').trim();
  if (!src) return null;
  for (const engine of [viaGoogle, viaMyMemory]) {
    try {
      return fixTerms(await engine(src)).trim();
    } catch (e) {
      console.warn(`번역 실패(${engine.name}): ${e.message}`);
    }
  }
  return null;
}
