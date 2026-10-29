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
    <select className="lang-select" aria-label={t('lang.label', lang)} value={lang} onChange={(e) => onChange(e.target.value as Lang)}>
      {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.label}</option>)}
    </select>
  )
}
