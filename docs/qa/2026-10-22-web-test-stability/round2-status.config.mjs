import base from './vitest.config.ts';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export default {
  ...base,
  plugins: [...base.plugins, {
    name: 'audit-premature-announcement',
    enforce: 'pre',
    transform(source, id) {
      if (process.env.GG_STRENGTHEN === '1' && id.replaceAll('\\', '/').endsWith('/forms/cron/control.test.tsx')) return readFileSync(join(process.env.TEMP,'gg-chore-web-stronger-cron.txt'),'utf8');
      if (process.env.GG_CRON_MUTATION !== '1' || !id.replaceAll('\\', '/').endsWith('/forms/cron/control.tsx')) return;
      const start = source.indexOf('  const announcement =');
      const end = source.indexOf('  return { query, enabled, valid: requestable, announcement };', start);
      if (start < 0 || end < 0) throw new Error('Missing announcement boundary');
      const separate = `  const [announced, setAnnounced] = useState(settled);
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced({ expression, timezone, summary, valid: requestable }), 0);
    return () => clearTimeout(timer);
  }, [expression, timezone, summary, requestable]);
`;
      return source.slice(0, start) + separate + source.slice(start, end).replaceAll('settled.', 'announced.') + source.slice(end);
    },
  }],
};
