import { sanitizePlainText, sanitizeSafeUrl } from './inputSecurity';

export const EMAIL_VERIFICATION_COMPANY_NAME = "O'NDE LUIGI";
export const EMAIL_VERIFICATION_SUBJECT = "Verifica tu correo electrónico — O'NDE LUIGI";

export interface VerificationEmailTemplateParams {
  recipientName: string;
  recipientEmail: string;
  logoUrl: string;
  actionUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBrandVerificationEmailHtml({
  recipientName,
  recipientEmail,
  logoUrl,
  actionUrl = '%LINK%',
}: VerificationEmailTemplateParams): string {
  const safeName = escapeHtml(
    sanitizePlainText(recipientName, { maxLen: 80 }) || 'Integrante del equipo'
  );
  const safeEmail = escapeHtml(sanitizePlainText(recipientEmail, { maxLen: 160 }));
  const safeLogo = escapeHtml(
    sanitizeSafeUrl(logoUrl, { allowDataImage: false, allowRelative: true, maxLen: 500 }) ||
      '/onde-luigi-logo.png'
  );
  const normalizedAction =
    actionUrl === '%LINK%'
      ? '%LINK%'
      : sanitizeSafeUrl(actionUrl, { allowDataImage: false, allowRelative: false, maxLen: 500 }) ||
        '#';
  const safeActionUrl = escapeHtml(normalizedAction);

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${EMAIL_VERIFICATION_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:24px;background-color:#0A0A0A;font-family:Arial,Helvetica,sans-serif;color:#FFFFFF;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background-color:#141418;border:1px solid #27272E;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:28px 24px 20px;text-align:center;background-color:#101014;border-bottom:2px solid #DC2626;">
          <img src="${safeLogo}" alt="Logo ${EMAIL_VERIFICATION_COMPANY_NAME}" width="72" height="72" style="width:72px;height:72px;border-radius:9999px;border:2px solid #DC2626;object-fit:cover;display:block;margin:0 auto 12px;" />
          <div style="font-size:22px;font-weight:800;letter-spacing:1px;color:#FFFFFF;">${EMAIL_VERIFICATION_COMPANY_NAME}</div>
          <div style="font-size:12px;font-weight:700;color:#F59E0B;margin-top:4px;text-transform:uppercase;">Verificación oficial de cuenta</div>
        </td>
      </tr>
      <tr>
        <td style="padding:26px 24px;font-size:14px;line-height:1.6;color:#E4E4E7;">
          <p style="margin:0 0 12px;">Hola <strong style="color:#FFFFFF;">${safeName}</strong>,</p>
          <p style="margin:0 0 16px;">
            Esta es la verificación de correo electrónico para <strong style="color:#F59E0B;">${EMAIL_VERIFICATION_COMPANY_NAME}</strong>.
            Confirma tu dirección (<span style="color:#FFFFFF;">${safeEmail}</span>) para activar por completo tu acceso al sistema de pedidos y caja.
          </p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${safeActionUrl}" style="display:inline-block;background-color:#F59E0B;color:#000000;font-weight:800;font-size:14px;text-decoration:none;padding:13px 26px;border-radius:12px;">
              Verificar mi correo en ${EMAIL_VERIFICATION_COMPANY_NAME}
            </a>
          </div>
          <p style="margin:0;font-size:12px;color:#A1A1AA;">
            Si no creaste esta cuenta en ${EMAIL_VERIFICATION_COMPANY_NAME}, puedes ignorar este mensaje.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 24px;background-color:#101014;border-top:1px solid #27272E;text-align:center;font-size:11px;color:#71717A;">
          ${EMAIL_VERIFICATION_COMPANY_NAME} · Sistema Interno de Pedidos y Caja
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
