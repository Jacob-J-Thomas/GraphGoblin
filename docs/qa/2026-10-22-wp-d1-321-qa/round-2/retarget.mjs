// Transform test resource locations only; never production code.
export const retarget = {
  name: 'qa-resource-targets',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.test\.tsx?$|api-subprocess\.ts$|global-setup\.ts$/.test(id.split('?')[0])) return;
    return code
      .replaceAll("'gg-", "'gg-qa-321-r2-")
      .replaceAll('[5910, 5919]', '[5920, 5929]')
      .replaceAll('[5600, 5699]', '[5920, 5929]');
  },
};
