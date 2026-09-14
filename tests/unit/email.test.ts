import { expect, test } from "vitest";
import { escapeHtml } from "@/lib/email";

test("escapeHtml escapes the HTML-sensitive characters", () => {
  expect(escapeHtml(`<script>alert("x")</script> & 'quotes'`)).toBe(
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;"
  );
});

test("escapeHtml leaves plain text untouched", () => {
  expect(escapeHtml("Checkout clean at Villa Azul")).toBe("Checkout clean at Villa Azul");
});
