import { useDocumentTitle } from '../components/ui.tsx';
import { Link } from '../router.tsx';

/** An address with no page behind it: the number set like the almanac's date, with a 迷 seal across its corner. */
export function Placeholder({ title, kicker }: { title: string; kicker: string }) {
  useDocumentTitle(title);
  return (
    <div className="page lost">
      <div className="lost-figure" aria-hidden="true">
        <span className="lost-n">{kicker}</span>
        <span className="seal lost-seal">迷</span>
      </div>
      <h1 className="lost-title">{title}</h1>
      <p className="muted">这个地址没有对应的页面，可能是链接过期了。</p>
      <Link to="/" className="btn">回到今天</Link>
    </div>
  );
}
