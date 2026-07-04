import { APP_LOGO_SRC } from '../config/assets';

type LerzoLogoLoaderProps = {
  visible: boolean;
  label?: string;
  overlay?: 'full' | 'inline';
};

export default function LerzoLogoLoader({
  visible,
  label = 'Loading...',
  overlay = 'full',
}: LerzoLogoLoaderProps) {
  const className = [
    'lerzo-page-loader',
    overlay === 'inline' ? 'lerzo-page-loader--inline' : '',
    visible ? 'is-visible' : 'is-hidden',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} aria-live="polite" aria-busy={visible} aria-label={label}>
      <div className="lerzo-page-loader__content">
        <img src={APP_LOGO_SRC} alt="Lerzo" className="lerzo-page-loader__logo" />
        {label ? <p className="lerzo-page-loader__label">{label}</p> : null}
      </div>
    </div>
  );
}
