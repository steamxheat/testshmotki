import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const categories = [
  'Верхняя одежда', 'Толстовки и свитшоты', 'Футболки', 'Рубашки',
  'Брюки', 'Джинсы', 'Шорты', 'Обувь', 'Головные уборы', 'Аксессуары',
];

async function main() {
  const ownerId = process.env.STORE_OWNER_TELEGRAM_ID;
  const slug = process.env.STORE_SLUG;
  if (!ownerId || !/^\d+$/.test(ownerId)) throw new Error('Укажите STORE_OWNER_TELEGRAM_ID');
  if (!slug || !/^[a-z0-9_]{3,32}$/.test(slug)) throw new Error('Укажите STORE_SLUG');

  const owner = await prisma.user.upsert({
    where: { telegramId: BigInt(ownerId) },
    create: { telegramId: BigInt(ownerId) },
    update: {},
  });
  const store = await prisma.store.upsert({
    where: { slug },
    create: {
      slug,
      name: process.env.STORE_NAME?.trim() || 'Мой магазин',
      contactUsername: process.env.STORE_CONTACT_USERNAME?.trim() || null,
      settings: { accentColor: '#486876' },
    },
    update: {},
  });
  await prisma.storeMember.upsert({
    where: { storeId_userId: { storeId: store.id, userId: owner.id } },
    create: { storeId: store.id, userId: owner.id, role: 'owner' },
    update: { role: 'owner' },
  });
  if (await prisma.category.count({ where: { storeId: store.id } }) === 0) {
    await prisma.category.createMany({
      data: categories.map((name, sortOrder) => ({ storeId: store.id, name, sortOrder })),
    });
  }
  console.log(`Магазин «${store.name}» готов: ${store.slug}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
