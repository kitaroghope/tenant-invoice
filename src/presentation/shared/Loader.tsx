interface LoaderProps {
  label?: string
  fullRegion?: boolean
}

export function Loader({ label = 'Loading…', fullRegion = false }: LoaderProps) {
  if (fullRegion) {
    return (
      <div className="loader loader-region" role="status">
        <span className="loader-spinner" aria-hidden="true" />
        <span>{label}</span>
      </div>
    )
  }
  return (
    <span className="loader loader-inline" role="status">
      <span className="loader-spinner" aria-hidden="true" />
      <span className="loader-sr">{label}</span>
    </span>
  )
}
