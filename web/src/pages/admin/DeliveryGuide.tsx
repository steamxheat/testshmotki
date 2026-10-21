import { Link, useLocation, useParams } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { Empty } from '../../components/ui';
import { CdekConnection } from './CdekConnection';

type Step = { title: string; text: string; icon: IconName };
type Guide = { title: string; intro: string; today: string; seller: string[]; automatic: string[]; caveat: string; steps: Step[]; links: { label: string; href: string }[] };

const guides: Record<string, Guide> = {
  cdek: {
    title: 'СДЭК',
    intro: 'Покупатель выбирает ПВЗ. Для автоматического оформления отправления продавцу нужен собственный договор и доступ к API СДЭК.',
    today: 'После подключения ключей покупатель видит тариф СДЭК при выборе ПВЗ. Продавец может создать отправление из оплаченного заказа. Сервис сам проверяет создание накладной и передаёт трек-номер покупателю; ярлык и код сдачи пока не выдаются в приложении.',
    seller: ['Заключить договор со СДЭК и получить два значения: идентификатор аккаунта и секретный ключ.', 'Один раз указать адрес и телефон отправителя. Для точного тарифа понадобятся вес и габариты каждой упакованной посылки.'],
    automatic: ['Покупатель выбирает ПВЗ и видит тариф с общей суммой.', 'После подтверждения оплаты продавец создаёт накладную; её номер проверяется автоматически.', 'Ярлык, код сдачи и отслеживание пути посылки — следующий этап.'],
    caveat: 'СДЭК выставляет счёт владельцу договора, чьи ключи использованы. Оплата доставки покупателем продавцу — отдельный расчёт; один API-ключ не создаёт автоматическую оплату покупателем в СДЭК.',
    steps: [
      { title: 'Оформите договор', text: 'Заключите договор со СДЭК и дождитесь статуса «Подписан». Без него рабочие ключи для отправлений не действуют.', icon: 'orders' },
      { title: 'Получите ключи', text: 'В личном кабинете СДЭК откройте «Интеграция» → «Создать ключ». Сохраните идентификатор аккаунта и пароль в безопасном месте.', icon: 'lock' },
      { title: 'Подготовьте отправку', text: 'Укажите данные отправителя и параметры упаковки. Продавец не выбирает список ПВЗ для покупателей — они выбирают пункт назначения сами.', icon: 'package' },
      { title: 'Проверьте тестовый заказ', text: 'Сначала проверьте создание и отмену заказа в тестовой среде, получение документа и статусов. Только после этого включайте рабочую отправку.', icon: 'check' },
    ],
    links: [
      { label: 'Договор со СДЭК', href: 'https://www.cdek.ru/ru/contract/' },
      { label: 'Официальная документация API', href: 'https://apidoc.cdek.ru/' },
    ],
  },
  russian_post: {
    title: 'Почта России',
    intro: 'API сервиса «Отправка» позволяет готовить заказы, ярлыки и документы, но требует отдельного доступа продавца.',
    today: 'Сейчас покупатель может выбрать ручной вариант Почты России, а продавец — указать адрес и стоимость. Заявка не передаётся в Почту России автоматически.',
    seller: ['Подключить сервис «Отправка» и получить два значения: токен приложения и ключ пользователя.', 'Один раз указать данные отправителя и отделение сдачи. Для заказа нужны вес и параметры посылки.'],
    automatic: ['Получить адрес покупателя из заявки и проверить индекс.', 'Рассчитать стоимость, создать отправление и подготовить ярлык.', 'Передать покупателю трек-номер и обновлять статус доставки.'],
    caveat: 'Условия оплаты и сдачи отправлений зависят от договора продавца с Почтой России; ключи API сами по себе не оплачивают доставку.',
    steps: [
      { title: 'Заведите кабинет', text: 'Подключите для своего бизнеса онлайн-сервис «Отправка» и уточните условия приёма отправлений.', icon: 'orders' },
      { title: 'Получите доступ к API', text: 'В кабинете или через поддержку сервиса получите токен приложения и ключ пользователя. Не используйте логин и пароль вместо этих ключей.', icon: 'lock' },
      { title: 'Подготовьте данные', text: 'Проверьте индекс, адреса, ФИО и телефон получателя, а также вес, габариты и тип отправления.', icon: 'location' },
      { title: 'Проверьте оформление', text: 'До реальных заказов проверьте расчёт, создание отправления, печать ярлыка и передачу трек-номера покупателю.', icon: 'check' },
    ],
    links: [
      { label: 'Сервис «Отправка»', href: 'https://otpravka.pochta.ru/' },
      { label: 'Официальная спецификация API', href: 'https://otpravka.pochta.ru/specification' },
    ],
  },
  yandex_delivery: {
    title: 'Яндекс Доставка',
    intro: 'Для доставки в ПВЗ нужен бизнес-кабинет Яндекс Доставки и API доставки «в другой день». Это не API Яндекс Маркета.',
    today: 'Сейчас доступен ручной вариант доставки. ПВЗ, тарифы и заказы Яндекса не загружаются и не создаются автоматически.',
    seller: ['Подключить бизнес-кабинет Яндекс Доставки и получить токен API.', 'Выбрать способ отгрузки и получить идентификатор склада или станции отправления; указать данные отправителя и параметры посылки.'],
    automatic: ['Показать доступные ПВЗ и тарифы для адреса покупателя.', 'После подтверждения заявки создать отправление и получить ярлык.', 'Передавать трек-номер и статусы в магазин.'],
    caveat: 'Для доставки в ПВЗ нужен API доставки «в другой день», а не Яндекс Маркета. Токена недостаточно без настроенной точки отгрузки и условий оплаты.',
    steps: [
      { title: 'Подключите бизнес-кабинет', text: 'Зарегистрируйте компанию в Яндекс Доставке, подтвердите условия сервиса и определите, будете ли сдавать посылки сами или передавать курьеру.', icon: 'orders' },
      { title: 'Получите токен', text: 'Под владельцем кабинета откройте раздел «Интеграция» и получите токен API. Для боевой отгрузки уточните у менеджера идентификатор точки отправления.', icon: 'lock' },
      { title: 'Проверьте ПВЗ и тарифы', text: 'API должен вернуть актуальные пункты выдачи и варианты доставки для конкретного заказа. Цена и сроки зависят от параметров посылки и маршрута.', icon: 'location' },
      { title: 'Протестируйте полный путь', text: 'Проверьте тестовый заказ, подтверждение тарифа, ярлык и смену статусов. Затем отдельно согласуйте рабочий запуск.', icon: 'check' },
    ],
    links: [
      { label: 'Как подключить сервис', href: 'https://yandex.ru/support/delivery-profile/ru/other-day/how-to-join' },
      { label: 'Доступ к API', href: 'https://yandex.ru/support/delivery-profile/ru/api/other-day/access' },
      { label: 'Список методов API', href: 'https://yandex.ru/support/delivery-profile/ru/api/other-day/ref/' },
    ],
  },
};

function GuideDiagram({ title }: { title: string }) {
  return (
    <div className="delivery-guide-diagram" role="img" aria-label={`Схема подключения ${title}: кабинет перевозчика, ключ API, проверка заказа`}>
      <div><Icon name="home" size={24} /><span>Кабинет {title}</span></div>
      <Icon name="chevronRight" size={18} />
      <div><Icon name="lock" size={24} /><span>Доступ к API</span></div>
      <Icon name="chevronRight" size={18} />
      <div><Icon name="package" size={24} /><span>Тест заказа</span></div>
    </div>
  );
}

export function DeliveryGuide() {
  const location = useLocation();
  const { method } = useParams();
  const guide = method ? guides[method] : undefined;
  const back = { pathname: '/admin/settings', search: location.search };
  if (!guide) return <div className="page"><Empty icon="compass" title="Инструкция не найдена" action={<Link className="btn small outline" to={back}>К настройкам</Link>} /></div>;

  return (
    <main className="page delivery-guide-page">
      <Link className="delivery-guide-back" to={back}><Icon name="back" size={18} />К настройкам доставки</Link>
      <h1>Как подключить {guide.title}</h1>
      <p className="delivery-guide-intro">{guide.intro}</p>
      <GuideDiagram title={guide.title} />
      <p className="small muted delivery-guide-caption">Схема показана для ориентира; названия разделов в кабинетах перевозчиков могут измениться.</p>

      <section className="delivery-guide-current">
        <Icon name="alert" size={21} />
        <div><strong>Что работает сейчас</strong><p>{guide.today}</p></div>
      </section>

      {method === 'cdek' && <CdekConnection />}

      <section className="delivery-guide-section">
        <h2>Что нужно сделать продавцу</h2>
        <ul className="delivery-guide-checklist">{guide.seller.map((item) => <li key={item}><Icon name="check" size={18} />{item}</li>)}</ul>
      </section>

      <section className="delivery-guide-section">
        <h2>{method === 'cdek' ? 'Что уже связано с заказом' : 'Что приложение будет делать само'}</h2>
        {method !== 'cdek' && <p className="small muted delivery-guide-future">После разработки и проверки подключения на реальных доступах:</p>}
        <ul className="delivery-guide-checklist">{guide.automatic.map((item) => <li key={item}><Icon name="package" size={18} />{item}</li>)}</ul>
      </section>

      <p className="delivery-guide-caveat">{guide.caveat}</p>

      <details className="delivery-guide-details">
        <summary>Показать подробные шаги<Icon name="chevronDown" size={19} /></summary>
        <ol className="delivery-guide-steps">{guide.steps.map((step, index) => <li key={step.title}>
          <div className="delivery-guide-step-visual"><span>{index + 1}</span><Icon name={step.icon} size={28} /></div>
          <div><h3>{step.title}</h3><p>{step.text}</p></div>
        </li>)}</ol>
      </details>

      <section className="delivery-guide-section">
        <h2>Официальные страницы</h2>
        <div className="delivery-guide-resources">{guide.links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<Icon name="chevronRight" size={18} /></a>)}</div>
      </section>

      <p className="delivery-guide-security"><Icon name="lock" size={18} />Не отправляйте ключи API в чат и не вводите их в описание магазина. {method === 'cdek' ? 'Ключи СДЭК вводятся только в защищённую форму выше и не отображаются повторно.' : 'Для этой службы защищённой формы и автоматической отправки пока нет.'}</p>
    </main>
  );
}
