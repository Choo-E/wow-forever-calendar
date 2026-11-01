// 제목·요약 키워드로 기사 분류 (한국어/영어 공통)
const FOREVER = /forever|포에버|classic\+|클래식\+|클래식 플러스/i;
const PATCH = /핫픽스|hotfix|패치|patch|ptr|업데이트|\bupdate\b|\b\d{1,2}\.\d{1,2}\.\d{1,2}\b|\btuning\b|밸런스|\bfix(ed|es)?\b|수정/i;
const EVENT = /이벤트|event|축제|행사|블리즈컨|blizzcon|trading post|거래소|여행자|traveler|상점|\bshop\b|주간 소식|weekly|보너스|bonus|무료|\bfree\b|시즌|season|전 세계에 출시|goes live|live now|demo|데모/i;

export function classify(title = '', summary = '') {
  const text = `${title} ${summary}`;
  const forever = FOREVER.test(text);
  let category = 'news';
  if (PATCH.test(title)) category = 'patch';
  else if (EVENT.test(title)) category = 'event';
  else if (PATCH.test(text)) category = 'patch';
  return { category, forever };
}
