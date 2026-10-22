import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../app/providers';
import { api, ApiError } from '../lib/api';

export function LegalNotice({ onDone }: { onDone: (decision: 'accepted' | 'dismissed') => void }) {
  const { store } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision: 'accepted' | 'dismissed') {
    setBusy(true);
    setError('');
    try {
      await api.setLegalNotice(decision);
      onDone(decision);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить выбор. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="legal-intro page">
    <div className="legal-intro-card">
      <div className="legal-intro-mark" aria-hidden="true">{store?.name?.slice(0, 1).toLocaleUpperCase('ru-RU')}</div>
      <h1>Добро пожаловать в {store?.name}</h1>
      <p>Для работы магазина используются данные вашего профиля Telegram и технические сведения о посещении. При оформлении заявки продавец получит указанные вами имя, телефон, email, адрес доставки, сообщения и подтверждение перевода. Это нужно для заказа и связи с вами.</p>
      <p>Прочитайте <Link to="/legal/privacy">политику обработки данных</Link> и <Link to="/legal/terms">условия покупки и возврата</Link>. Согласие на обработку данных для заявки будет запрошено отдельно перед её отправкой. Подписка на рекламные уведомления не включается этим действием.</p>
      {error && <p className="legal-intro-error" role="alert">{error}</p>}
      <button className="btn" type="button" disabled={busy} onClick={() => void decide('accepted')}>{busy ? 'Сохраняем…' : 'Согласен, продолжить'}</button>
      <button className="btn outline" type="button" disabled={busy} onClick={() => void decide('dismissed')}>Продолжить без согласия</button>
      <p className="small muted">Без согласия можно просматривать каталог. Перед отправкой заявки вы сможете принять решение отдельно.</p>
    </div>
  </div>;
}
