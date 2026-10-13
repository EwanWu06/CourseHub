import { Empty, Masthead } from '../components/ui.tsx';

export function Placeholder({ title, kicker }: { title: string; kicker: string }) {
  return (
    <div className="page">
      <Masthead kicker={kicker} title={title} />
      <Empty glyph="筑">这一页正在制作中。</Empty>
    </div>
  );
}
