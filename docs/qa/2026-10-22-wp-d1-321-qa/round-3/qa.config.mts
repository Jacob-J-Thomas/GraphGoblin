import original from '../../../../apps/api/vitest.config.ts';

// QA resource names only. Keep the tested port ranges, concurrency and assertions unchanged.
export default {
  ...original,
  plugins: [
    ...(original.plugins ?? []),
    {
      name: 'qa-store-prefix',
      enforce: 'pre' as const,
      transform(code: string, id: string) {
        if (
          !/\.test\.tsx?$|api-subprocess\.ts$|test-app\.ts$|global-setup\.ts$/.test(
            id.split('?')[0]!,
          )
        )
          return;
        return code.replaceAll("'gg-", "'gg-qa-321-r3-");
      },
    },
  ],
};
