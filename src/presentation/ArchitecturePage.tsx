import { container } from '../shared/container'
import { Link } from 'react-router-dom'

const layers = [
  ['Domain', 'Entities, value objects, invariants and financial rules'],
  ['Application', 'Use cases and technology-independent ports'],
  ['Infrastructure', 'Supabase repositories, authentication and storage adapters'],
  ['Presentation', 'React routes, forms, document previews and print layouts'],
] as const

export function ArchitecturePage() {
  return (
    <main className="shell">
      <header className="hero">
        <span className="eyebrow">Kita Invoice</span>
        <h1>A clean foundation for every business.</h1>
        <p>Multi-tenant invoicing, receipts, roles, currencies and auditability—built as a static application with Supabase as its source of truth.</p>
        <div className={container.configuration ? 'status ready' : 'status waiting'}>
          <span aria-hidden="true" />
          {container.configuration ? 'Supabase configuration detected' : 'Add .env.local to connect Supabase'}
        </div>
        <div className="hero-actions"><Link className="primary link-button" to="/auth">Enter the application</Link></div>
      </header>
      <section className="grid" aria-label="Application architecture">
        {layers.map(([name, description], index) => (
          <article className="card" key={name}>
            <small>0{index + 1}</small>
            <h2>{name}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
