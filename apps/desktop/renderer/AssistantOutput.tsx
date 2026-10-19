import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { outputLink } from '../../../packages/ui/src/output-link.js';

export function AssistantOutput({ text, onOpenLink }: { text: string; onOpenLink: (url: string) => void }) {
  return <div className="assistant-output">
    <Markdown remarkPlugins={[remarkGfm]} remarkRehypeOptions={{ footnoteLabel: '补充说明', footnoteBackLabel: '返回正文' }} skipHtml urlTransform={(url, key) => key === 'href' && outputLink(url) ? url : ''} components={{
      a({ href, children, id }) {
        const destination = outputLink(href);
        if (!destination) return <span>{children}</span>;
        if (destination.kind === 'fragment') return <button type="button" id={id} className="assistant-link" onClick={event => {
          const container = event.currentTarget.closest('.assistant-output');
          const target = Array.from(container?.querySelectorAll<HTMLElement>('[id]') ?? []).find(item => item.id === destination.id);
          target?.scrollIntoView({ block: 'nearest' });
        }}>{children}</button>;
        return <button type="button" className="assistant-link" data-output-url={destination.url}
          title={`在内置浏览器打开：${destination.host}`}
          onClick={() => onOpenLink(destination.url)}>{children}<span aria-hidden="true"> ↗</span></button>;
      },
      img({ alt }) { return alt ? <span className="assistant-image-note">图片说明：{alt}</span> : null; },
      table({ children }) { return <div className="assistant-table-scroll"><table>{children}</table></div>; },
    }}>{text}</Markdown>
  </div>;
}
