import qrcode from 'qrcode-generator';

/** Generate locally: enrollment secrets never leave the gateway browser for a QR service. */
export function PairingQr({ url }: { url: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return (
    <figure className="my-3 grid justify-items-start gap-2">
      <img
        src={qr.createDataURL(5, 20)}
        alt="Scan this pairing link on the device you want to pair"
        className="h-auto max-w-full rounded-md"
      />
      <figcaption className="text-xs text-muted">Scan to open the same pairing link.</figcaption>
    </figure>
  );
}
