// 평가 참여자 응답 화면(모바일) 공통 부품과 언어 선택 (D-075).
// 언어는 같은 브라우저에 기억해 다음 접속에도 적용한다(i18n getLang/setLang). 번역이 없는 항목은 한국어 원문 — 경고 배너 없음.
import { LANGUAGES, t } from '../../i18n'
import type { Lang } from '../../domain/types'
import emblem from '../../assets/emblem.png'

export { getLang, setLang } from '../../i18n'

export function MobileHead({ title }: { title: string }) {
  return (
    <div className="m-head">
      <img src={emblem} alt="" />
      <span className="t">{title}</span>
    </div>
  )
}

/** 한국어 / Русский 두 가지만 */
export function LangSelect({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    // D-246: 앞에 지구본 그림 — 외국인 직원이 글자를 못 읽어도 언어 선택임을 알아보게
    <span className="lang-wrap">
      <svg className="lang-globe" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19" /><path d="M12 2.5c2.6 2.6 4 6 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-6-4-9.5s1.4-6.9 4-9.5z" />
      </svg>
      <select className="lang-select" aria-label={t('lang.label', lang)} value={lang} onChange={(e) => onChange(e.target.value as Lang)}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
      </select>
    </span>
  )
}
