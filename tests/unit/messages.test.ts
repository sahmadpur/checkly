import { expect, test } from "vitest";
import { createTranslator } from "next-intl";
import { LOCALES, MESSAGES } from "@/lib/i18n";

type Tree = { [k: string]: string | Tree };
const leaves = (o: Tree, prefix = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : leaves(v, `${prefix}${k}.`)));

const en = leaves(MESSAGES.en as Tree).sort();

test.each(LOCALES)("%s has the same keys as en", (locale) => {
  expect(leaves(MESSAGES[locale] as Tree).sort()).toEqual(en);
});

const get = (o: Tree, path: string) => path.split(".").reduce<Tree | string>((cur, k) => (cur as Tree)[k], o) as string;

test.each(LOCALES)("%s messages all render", (locale) => {
  const t = createTranslator({ locale, messages: MESSAGES[locale], onError: (e) => { throw e; } });
  for (const key of en) {
    const msg = get(MESSAGES[locale] as Tree, key);
    const args: Record<string, unknown> = {};
    for (const [, name] of msg.matchAll(/\{\s*(\w+)/g)) args[name] = 1;
    for (const [, tag] of msg.matchAll(/<(\w+)>/g)) args[tag] = (c: string) => c;
    expect(typeof t.markup(key as never, args as never)).toBe("string");
  }
});
