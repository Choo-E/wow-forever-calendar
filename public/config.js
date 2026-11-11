// 공개용 설정. 이 두 값은 원래 웹페이지에 들어가도록 만들어진 "공개용"이라 올려도 안전하다.
// 데이터를 지키는 것은 키가 아니라 데이터베이스의 접근 규칙(RLS, supabase/schema.sql)이다.
//
// 🚫 여기에 절대 넣으면 안 되는 것: secret key / service_role key, DB 비밀번호, Discord Client Secret
window.APP_CONFIG = {
  supabaseUrl: 'https://mstnhofzainznwbexfbn.supabase.co',
  supabaseKey: 'sb_publishable_iT0VLd3ZCLu7lqdHTuHnug_m0abOrig',
};
