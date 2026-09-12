import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!resend) {
    console.log(`[email] to=${to} subject=${subject}\n${html}`);
    return;
  }
  await resend.emails.send({ from: process.env.EMAIL_FROM ?? "Checkly <noreply@example.com>", to, subject, html });
}
