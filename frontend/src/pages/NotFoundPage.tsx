import { Link } from 'react-router-dom'
import { ArrowLeft, Compass } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-4">
      <div className="text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-mint-300">
          <Compass size={26} />
        </span>
        <p className="mt-4 font-display text-5xl font-semibold text-white">404</p>
        <p className="mt-2 font-display text-lg text-mist-200">This record is not in the vault</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-mist-500">
          The page may have moved, or your role does not expose it. Try the register or the public tracker.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/" className="btn btn-primary">
            <ArrowLeft size={15} /> Back to overview
          </Link>
          <Link to="/instruments" className="btn btn-secondary">
            Open FDR register
          </Link>
        </div>
      </div>
    </div>
  )
}
