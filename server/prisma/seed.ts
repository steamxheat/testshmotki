import { PrismaClient, ProductCondition, ProductStatus } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  'Верхняя одежда',
  'Толстовки и свитшоты',
  'Футболки',
  'Рубашки',
  'Брюки',
  'Джинсы',
  'Шорты',
  'Обувь',
  'Головные уборы',
  'Аксессуары',
];

const img = (seed: string) => `https://picsum.photos/seed/${seed}/600/800`;

// демо-владелец магазина (используйте этот Telegram ID в dev-режиме X-Dev-User для входа в админку)
const OWNER_TELEGRAM_ID = 100100100n;

async function main() {
  console.log('Сидирование демо-данных…');

  const owner = await prisma.user.upsert({
    where: { telegramId: OWNER_TELEGRAM_ID },
    create: { telegramId: OWNER_TELEGRAM_ID, firstName: 'Никита', username: 'nikita_seller' },
    update: { firstName: 'Никита', username: 'nikita_seller' },
  });

  const store = await prisma.store.upsert({
    where: { slug: 'nikita' },
    create: {
      slug: 'nikita',
      name: 'NIKITA STREET',
      description: 'Streetwear и винтаж с проверкой качества. Москва, отправка СДЭК.',
      city: 'Москва',
      contactUsername: 'nikita_seller',
      logoUrl: img('nikitalogo'),
      coverUrl: img('nikitacover'),
      settings: {
        deliveryMethods: ['meetup', 'cdek', 'russian_post', 'discuss'],
        accentColor: '#ff5a1f',
        showSold: true,
        blocks: { newArrivals: true, discounted: true, recent: true },
        responseSchedule: 'Отвечаю с 10:00 до 22:00 (МСК)',
        reservationRules: 'Бронь держится 24 часа.',
        socialLinks: { telegram: 'https://t.me/nikita_seller' },
      },
    },
    update: {},
  });

  await prisma.storeMember.upsert({
    where: { storeId_userId: { storeId: store.id, userId: owner.id } },
    create: { storeId: store.id, userId: owner.id, role: 'owner' },
    update: { role: 'owner' },
  });

  // категории
  const existingCats = await prisma.category.count({ where: { storeId: store.id } });
  if (existingCats === 0) {
    await prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((name, i) => ({ storeId: store.id, name, sortOrder: i })),
    });
  }
  const cats = await prisma.category.findMany({ where: { storeId: store.id } });
  const cat = (name: string) => cats.find((c) => c.name === name)!;

  // товары
  const productsCount = await prisma.product.count({ where: { storeId: store.id } });
  if (productsCount > 0) {
    console.log('Товары уже есть — пропускаю создание.');
    return;
  }

  type Seed = {
    title: string;
    category: string;
    price: number;
    oldPrice?: number;
    brand?: string;
    size?: string;
    color?: string;
    condition: ProductCondition;
    status?: ProductStatus;
    defects?: string;
    imgs: string[];
  };

  const seeds: Seed[] = [
    { title: 'Куртка The North Face Nuptse', category: 'Верхняя одежда', price: 18900, oldPrice: 24900, brand: 'The North Face', size: 'L', color: 'Чёрный', condition: 'excellent', imgs: ['tnf1', 'tnf2'] },
    { title: 'Худи Nike Tech Fleece', category: 'Толстовки и свитшоты', price: 7900, brand: 'Nike', size: 'M', color: 'Серый', condition: 'new_no_tag', imgs: ['nike1', 'nike2'] },
    { title: 'Свитшот Stüssy 8 Ball', category: 'Толстовки и свитшоты', price: 6500, oldPrice: 8900, brand: 'Stüssy', size: 'L', color: 'Чёрный', condition: 'good', imgs: ['stussy1'] },
    { title: 'Футболка Supreme Box Logo', category: 'Футболки', price: 12900, brand: 'Supreme', size: 'M', color: 'Белый', condition: 'new_with_tag', imgs: ['sup1', 'sup2'] },
    { title: 'Футболка Carhartt WIP Pocket', category: 'Футболки', price: 3200, brand: 'Carhartt', size: 'S', color: 'Белый', condition: 'excellent', imgs: ['carh1'] },
    { title: 'Рубашка Ralph Lauren Oxford', category: 'Рубашки', price: 4500, brand: 'Ralph Lauren', size: 'L', color: 'Голубой', condition: 'good', defects: 'Небольшая потёртость на воротнике', imgs: ['rl1'] },
    { title: 'Карго-брюки Nike ACG', category: 'Брюки', price: 8900, brand: 'Nike', size: '32', color: 'Хаки', condition: 'excellent', imgs: ['acg1', 'acg2'] },
    { title: 'Джинсы Levi’s 501 Vintage', category: 'Джинсы', price: 5900, oldPrice: 7500, brand: "Levi's", size: '31', color: 'Синий', condition: 'good', imgs: ['levis1'] },
    { title: 'Шорты Adidas Originals', category: 'Шорты', price: 2900, brand: 'Adidas', size: 'M', color: 'Чёрный', condition: 'new_no_tag', imgs: ['adi1'] },
    { title: 'Кроссовки New Balance 990v5', category: 'Обувь', price: 15900, oldPrice: 19900, brand: 'New Balance', size: '43', color: 'Серый', condition: 'excellent', imgs: ['nb1', 'nb2'] },
    { title: 'Кроссовки Nike Air Max 90', category: 'Обувь', price: 9900, brand: 'Nike', size: '42', color: 'Белый', condition: 'good', status: 'sold', imgs: ['am90'] },
    { title: 'Кепка New Era Yankees', category: 'Головные уборы', price: 2500, brand: 'New Era', size: 'OS', color: 'Синий', condition: 'new_with_tag', imgs: ['ne1'] },
    { title: 'Сумка Carhartt WIP Essentials', category: 'Аксессуары', price: 3900, brand: 'Carhartt', color: 'Чёрный', condition: 'excellent', imgs: ['bag1'] },
    { title: 'Шарф Acne Studios', category: 'Аксессуары', price: 6900, brand: 'Acne Studios', color: 'Розовый', condition: 'new_with_tag', imgs: ['scarf1'] },
    { title: 'Ветровка Arc’teryx (черновик)', category: 'Верхняя одежда', price: 21900, brand: "Arc'teryx", size: 'M', color: 'Чёрный', condition: 'excellent', status: 'draft', imgs: ['arc1'] },
  ];

  for (const s of seeds) {
    await prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: cat(s.category).id,
        title: s.title,
        priceAmount: s.price * 100,
        oldPriceAmount: s.oldPrice ? s.oldPrice * 100 : null,
        brand: s.brand ?? null,
        size: s.size ?? null,
        color: s.color ?? null,
        condition: s.condition,
        defects: s.defects ?? null,
        description: 'Оригинал, проверено. Замеры и детали — в чате с продавцом.',
        status: s.status ?? 'published',
        publishedAt: (s.status ?? 'published') === 'draft' ? null : new Date(),
        images: { create: s.imgs.map((seed, i) => ({ url: img(seed), sortOrder: i })) },
      } as never,
    });
  }

  console.log(`Готово: магазин «${store.name}» (slug «${store.slug}»), владелец Telegram ID ${OWNER_TELEGRAM_ID}.`);
  console.log(`Ссылка: https://t.me/<bot>/app?startapp=store_${store.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
