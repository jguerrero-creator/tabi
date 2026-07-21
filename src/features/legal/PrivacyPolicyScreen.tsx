import { Link } from 'react-router-dom'
import { strings } from '../../lib/strings'

export function PrivacyPolicyScreen() {
  const { title, lastUpdated, intro, sections } = strings.privacyPolicy

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4">
        <Link
          to="/"
          aria-label={strings.common.back}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        >
          ←
        </Link>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      </header>

      <main className="px-4 py-6">
        <p className="mb-6 text-xs text-slate-500">{lastUpdated}</p>

        <div className="space-y-4">
          {intro.map((paragraph) => (
            <p key={paragraph} className="text-sm text-slate-700">
              {paragraph}
            </p>
          ))}
        </div>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="mb-2 text-base font-semibold text-slate-900">{section.heading}</h2>
              <div className="space-y-3">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-sm text-slate-700">
                    {paragraph}
                  </p>
                ))}
                {section.list.length > 0 && (
                  <ul className="list-disc space-y-2 pl-5">
                    {section.list.map((item) => (
                      <li key={item} className="text-sm text-slate-700">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
