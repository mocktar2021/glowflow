import "server-only";

import { staffJoinLanguageHref, validStaffInvitationToken } from "@/lib/staff-invitations";

export type InvitationMessage = {
  subject: string;
  html: string;
  text: string;
};

const origin = "https://glowflow.mocktar.com";

const copy = {
  fr: {
    heading: "Invitation à rejoindre une équipe sur GlowFlow",
    body: "Un salon vous invite à rejoindre son équipe sur GlowFlow.",
    action: "Ouvrir l'invitation en français",
    expiry: "Ce lien expire 48 heures après sa création.",
    ignore: "Si vous n'attendiez pas cette invitation, ignorez cet e-mail.",
  },
  en: {
    heading: "Invitation to join a team on GlowFlow",
    body: "A salon has invited you to join its team on GlowFlow.",
    action: "Open the invitation in English",
    expiry: "This link expires 48 hours after it was created.",
    ignore: "If you did not expect this invitation, ignore this email.",
  },
  es: {
    heading: "Invitación para unirse a un equipo en GlowFlow",
    body: "Un salón te ha invitado a unirte a su equipo en GlowFlow.",
    action: "Abrir la invitación en español",
    expiry: "Este enlace caduca 48 horas después de su creación.",
    ignore: "Si no esperabas esta invitación, ignora este correo.",
  },
} as const;

/** Token links use fragments so the token is never sent in a GET request. */
export function renderStaffInvitationEmail(rawToken: string): InvitationMessage {
  if (!validStaffInvitationToken(rawToken)) throw new Error("Invalid invitation token");

  const sections = (Object.entries(copy) as Array<[keyof typeof copy, typeof copy.fr | typeof copy.en | typeof copy.es]>)
    .map(([locale, labels]) => {
      const url = `${origin}${staffJoinLanguageHref(locale, rawToken)}`;
      return { locale, labels, url };
    });

  return {
    subject: "GlowFlow : invitation à rejoindre une équipe",
    html: `<!doctype html><html lang="fr" dir="ltr"><head><meta charset="utf-8"><title>GlowFlow : invitation à rejoindre une équipe</title></head><body><div lang="fr" dir="ltr" style="font:16px/1.5 Arial,sans-serif;color:#16202c;background:#ffffff;max-width:600px;margin:auto;padding:24px"><h1 style="font-size:24px">GlowFlow</h1>${sections.map(({ locale, labels, url }) => `<section lang="${locale}" dir="ltr" style="padding:12px 0;border-bottom:1px solid #ded6ca"><h2 style="font-size:20px">${labels.heading}</h2><p>${labels.body}</p><p><a href="${url}" style="color:#80501f;text-decoration:underline">${labels.action}</a></p><p>${labels.expiry}</p><p>${labels.ignore}</p></section>`).join("")}</div></body></html>`,
    text: sections.map(({ locale, labels, url }) => `${locale.toUpperCase()}\n${labels.heading}\n${labels.body}\n${labels.action}: ${url}\n${labels.expiry}\n${labels.ignore}`).join("\n\n"),
  };
}
