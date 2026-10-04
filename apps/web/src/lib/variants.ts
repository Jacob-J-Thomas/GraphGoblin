import { clsx, type ClassValue } from 'clsx';

/** Variant groups: for each prop (for example `variant` or `size`), the classes of each choice. */
export type VariantGroups = Record<string, Record<string, ClassValue>>;

/** The props a variant function takes: one optional choice per group. */
export type VariantProps<V extends VariantGroups> = {
  [K in keyof V]?: keyof V[K] | undefined;
};

export interface VariantConfig<V extends VariantGroups> {
  /** Classes every choice shares. */
  base?: ClassValue;
  variants: V;
  /** The choice used when a prop is absent. */
  defaults: { [K in keyof V]: keyof V[K] };
}

/**
 * A tiny, typed stand-in for class-variance-authority: `variants({ base, variants, defaults })`
 * returns a function from variant props (plus an extra `className`) to a class string. Unknown keys
 * in the props are ignored, so callers can pass a component's props straight through.
 *
 *   const button = variants({ base: 'btn', variants: { size: { sm: 'h-8', md: 'h-9' } },
 *     defaults: { size: 'md' } });
 *   button({ size: 'sm', className: 'mt-2' }); // 'btn h-8 mt-2'
 */
export function variants<V extends VariantGroups>(config: VariantConfig<V>) {
  const groups = Object.keys(config.variants) as (keyof V)[];
  return (props: VariantProps<V> & { className?: ClassValue } = {}): string =>
    clsx(
      config.base,
      groups.map((group) => {
        const choice = props[group] ?? config.defaults[group];
        const choices = config.variants[group] as Record<string, ClassValue>;
        return choices[choice as string];
      }),
      props.className,
    );
}
