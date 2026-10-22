"""Local UI smoke test with mocked API: python3 scripts/ui-smoke.py."""

import json
from copy import deepcopy
from urllib.parse import quote, urlparse

from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:5183/shmotki/"
PHOTO = "data:image/svg+xml," + quote('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="#567563"/><path d="M30 40h60v90H30z" fill="#d8e1dd"/></svg>')
store = {
    "id": "s1", "slug": "nikita", "name": "PULLINUP STORE", "description": "Одежда и аксессуары",
    "city": "Москва", "contactUsername": "pullinup_store", "logoUrl": None, "coverUrl": None,
    "status": "active", "rating": 0, "reviewsCount": 0,
    "settings": {
        "deliveryMethods": ["meetup", "cdek", "yandex_delivery"], "cdekMode": "automatic", "responseSchedule": "", "reservationRules": "",
        "socialLinks": {}, "accentColor": "#486876", "backgroundUrl": PHOTO, "showSold": True,
        "privacyUrl": "https://example.org/privacy", "termsUrl": "https://example.org/terms",
        "legalName": None, "legalInn": None, "legalAddress": None, "legalEmail": None, "legalReady": False,
        "deliveryOptions": [{"id": "point1", "method": "cdek", "city": "Москва", "point": "СДЭК Тверская", "address": "Тверская, 1", "tariff": "Стандарт", "price": 450, "eta": "3–5 дней", "lat": 55.758, "lon": 37.613}, {"id": "point1_fast", "method": "cdek", "city": "Москва", "point": "СДЭК Тверская", "address": "Тверская, 1", "tariff": "Экспресс", "price": 650, "eta": "1–2 дня", "lat": 55.758, "lon": 37.613}, {"id": "meetup1", "method": "meetup", "city": "Москва", "point": "Встреча у метро", "address": "Тверская, 2", "tariff": "Встреча", "price": 0, "lat": 55.758, "lon": 37.613}],
        "blocks": {"newArrivals": True, "discounted": True, "recent": True}, "slugChangedAt": None,
    },
}
product = {
    "id": "p1", "storeId": "s1", "categoryId": "c1", "title": "Stone Island Pocket Crew Sweatshirt",
    "description": "Описание", "price": 2500, "priceAmount": 250000, "oldPrice": None,
    "discountPercent": None, "brand": "Test", "size": "M", "color": "чёрный",
    "condition": "good", "defects": None, "sellerSku": None, "status": "published",
    "variants": [{"id": "v1", "size": "M", "stock": 3, "available": 3}, {"id": "v2", "size": "L", "stock": 1, "available": 1}],
    "isReserved": False, "isSold": False, "isAvailable": True,
    "images": [{"id": f"im{i}", "url": PHOTO, "sortOrder": i} for i in range(3)], "coverUrl": PHOTO,
    "publishedAt": "2026-10-18T10:00:00Z", "createdAt": "2026-10-18T10:00:00Z",
    "updatedAt": "2026-10-18T10:00:00Z", "isFavorite": False,
}
order = {
    "id": "o1", "publicNumber": "TEST01", "storeId": "s1", "productId": "p1",
    "buyerId": "u1",
    "productTitle": product["title"], "price": 2500, "buyerName": "Покупатель",
    "buyerUsername": "buyer", "buyerPhone": None, "city": "Москва", "deliveryMethod": "meetup",
    "items": [{"productId": "p1", "variantId": "v1", "title": product["title"], "size": "M", "quantity": 2, "price": 2500}],
    "deliveryPoint": None, "deliveryTariff": None, "deliveryPrice": None,
    "receiptSubmittedAt": None, "paymentConfirmedAt": None, "paymentDetails": None,
    "comment": None, "status": "pending", "reservedUntil": "2026-10-19T10:00:00Z",
    "createdAt": "2026-10-18T10:00:00Z", "updatedAt": "2026-10-18T10:00:00Z",
    "cover": None, "hasReview": False, "history": [],
}
members = [{"userId": "u1", "role": "owner", "telegramId": "123", "firstName": "Владелец", "username": "owner"}]
seen_store_slugs = []
order_actions = []
chat_messages = []
order_requests = []
legal_notice_decision = None
profile = {"id": "u1", "firstName": "Владелец", "lastName": "", "username": "owner", "avatarUrl": None, "phone": None, "contactName": None, "contactEmail": None, "deliveryCity": None, "deliveryAddress": None}


def route_api(route):
    global store, legal_notice_decision, profile
    request = route.request
    parsed = urlparse(request.url)
    path = parsed.path.removeprefix("/shmotki/api")
    body = json.loads(request.post_data or "{}") if request.method in ("POST", "PATCH", "PUT") and "application/json" in request.headers.get("content-type", "") else {}
    result = {}
    if path == "/store/legal-notice":
        if request.method == "POST":
            legal_notice_decision = body["decision"]
        result = {"version": "test", "decision": legal_notice_decision}
    elif path == "/store":
        seen_store_slugs.append(request.headers.get("x-store-slug"))
        result = {"store": store}
    elif path == "/delivery/cdek/status":
        result = {"connected": True}
    elif path == "/delivery/cdek/cities":
        result = {"cities": [{"code": 44, "city": "Москва", "region": "Московская область"}]}
    elif path == "/delivery/cdek/points":
        result = {"points": [{"code": "MSK1", "name": "СДЭК Центр", "address": "Москва, Тверская, 1", "city": "Москва", "cityCode": 44, "lat": 55.758, "lon": 37.613}]}
    elif path == "/delivery/cdek/quote":
        result = {"available": True, "quote": {"tariffCode": 136, "tariffName": "Посылка ПВЗ—ПВЗ", "price": 420, "periodMin": 2, "periodMax": 4}}
    elif path == "/store/categories" or path == "/catalog/filters":
        categories = [{"id": "c1", "name": "Футболки", "parentId": None, "status": "active", "productCount": 1}]
        result = {"categories": categories, "brands": ["Test"], "sizes": ["M"], "colors": ["чёрный"], "conditions": ["good"], "priceMin": 2500, "priceMax": 2500, "hasDiscounted": False}
    elif path == "/catalog/home":
        result = {"newArrivals": [product], "discounted": [], "recent": [product]}
    elif path == "/catalog":
        result = {"items": [product], "total": 1, "page": 1, "pageSize": 20, "hasMore": False}
    elif path.startswith("/catalog/product/"):
        result = {"product": product}
    elif path == "/favorites":
        result = {"items": []}
    elif path == "/uploads" and request.method == "POST":
        result = {"urls": ["/uploads/smoke.webp"]}
    elif path == "/chat/media" and request.method == "POST":
        result = {"url": "/uploads/smoke.mp4", "mediaType": "video"}
    elif path == "/orders" and request.method == "POST":
        order_requests.append(body)
        result = {"order": order}
    elif path == "/orders":
        result = {"items": [order, {**order, "id": "o2", "publicNumber": "TEST02", "status": "completed", "hasReview": True}, {**order, "id": "o3", "publicNumber": "TEST03", "status": "completed", "hasReview": False}]}
    elif path.endswith("/receipt") and request.method == "POST":
        result = {"ok": True}
    elif path == "/chat" and request.method == "POST":
        chat_messages.append({"id": f"m{len(chat_messages)+1}", "text": body["text"], "mediaUrl": body.get("mediaUrl"), "mediaType": body.get("mediaType"), "createdAt": "2026-10-18T10:00:00Z", "mine": True, "product": {"id": "p1", "title": product["title"]} if body.get("productId") else None})
        result = {"id": chat_messages[-1]["id"]}
    elif path == "/chat":
        result = {"items": chat_messages, "nextCursor": None}
    elif path == "/admin/s1/chats":
        result = {"items": [{"buyer": {"id": "u1", "firstName": "Покупатель", "lastName": "", "username": "buyer", "avatarUrl": None}, "updatedAt": "2026-10-18T10:00:00Z", "preview": chat_messages[-1]["text"], "product": chat_messages[-1]["product"]}] if chat_messages else []}
    elif path == "/admin/s1/chats/u1" and request.method == "POST":
        chat_messages.append({"id": f"m{len(chat_messages)+1}", "text": body["text"], "mediaUrl": body.get("mediaUrl"), "mediaType": body.get("mediaType"), "createdAt": "2026-10-18T10:01:00Z", "mine": False, "product": {"id": "p1", "title": product["title"]} if body.get("productId") else None})
        result = {"id": chat_messages[-1]["id"]}
    elif path == "/admin/s1/chats/u1":
        result = {"items": [{**item, "mine": not item["mine"]} for item in chat_messages], "nextCursor": None}
    elif path == "/reviews" and request.method == "POST":
        result = {"review": {"id": "r1"}}
    elif path == "/reviews":
        result = {"items": [], "rating": 0, "reviewsCount": 0}
    elif path == "/profile":
        if request.method == "PATCH":
            profile.update(body)
            result = {"ok": True}
        else:
            result = {"user": profile, "ordersCount": 0, "stores": [{"id": "s1", "role": "owner"}]}
    elif path.endswith("/overview"):
        result = {"activeProducts": 1, "reservedProducts": 0, "newOrders": 1, "completedOrders": {"d7": 0, "d30": 0}, "catalogViews": {"d7": 0, "d30": 0}, "favoriteAdds": 0, "conversion": 0, "recentEvents": []}
    elif path.endswith("/products/p1"):
        result = {"product": product}
    elif path.endswith("/products"):
        result = {"items": [product]}
    elif path.endswith("/categories"):
        result = {"categories": [{"id": "c1", "name": "Футболки", "parentId": None, "status": "active", "productCount": 1}]}
    elif path.endswith("/orders"):
        result = {"items": [order]}
    elif path.endswith("/cdek/manual-price") and request.method == "POST":
        order["deliveryPrice"] = body["price"]
        result = {"ok": True}
    elif path.endswith("/reviews"):
        result = {"items": []}
    elif path.endswith("/settings") and request.method == "PATCH":
        store = {**store, **{k: v for k, v in body.items() if k != "settings"}, "settings": {**store["settings"], **body.get("settings", {})}}
        result = {"store": store}
    elif path.endswith("/settings"):
        result = {"store": store, "paymentDetails": "СБП +79990000000", "myRole": "owner", "members": members}
    elif path.endswith("/delivery/cdek") and request.method == "GET":
        result = {"connection": {"connected": False}}
    elif path.endswith("/delivery/cdek") and request.method == "PUT":
        result = {"connected": True, "mode": body["mode"]}
    elif path.endswith("/members") and request.method == "POST":
        members.append({"userId": "u2", "role": "manager", "telegramId": body["telegramId"], "firstName": "Сотрудник", "username": None})
        result = {"ok": True}
    elif path.endswith("/accept") or path.endswith("/reject") or path.endswith("/complete"):
        order_actions.append(path)
        result = {"ok": True}
    elif path.startswith("/events") or path.startswith("/admin/"):
        result = {"ok": True}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(deepcopy(result), ensure_ascii=False))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    first_context = browser.new_context(viewport={"width": 375, "height": 812})
    first_page = first_context.new_page()
    first_page.route("https://telegram.org/js/**", lambda route: route.abort())
    first_page.route("**/shmotki/api/**", route_api)
    first_page.goto(BASE)
    first_page.get_by_role("button", name="Согласен, продолжить").click()
    first_page.get_by_role("link", name="Каталог").wait_for()
    assert legal_notice_decision == "accepted", "first-visit consent was not saved without seller details"
    first_context.close()
    for width, height in [(320, 720), (375, 812), (667, 375)]:
        context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
        page = context.new_page()
        page.route("https://telegram.org/js/**", lambda route: route.abort())
        page.route("**/shmotki/api/**", route_api)
        for path in ["", "catalog", "favorites", "cart", "orders", "profile", "reviews", "product/p1", "checkout/p1", "chat", "admin", "admin/products", "admin/products/new", "admin/products/p1", "admin/categories", "admin/orders", "admin/chats", "admin/reviews", "admin/settings", "admin/settings/delivery/cdek", "admin/settings/delivery/russian_post", "admin/settings/delivery/yandex_delivery"]:
            page.goto(BASE + path)
            page.locator(".page, .admin-view").first.wait_for(timeout=5000)
            page.locator(".loader").wait_for(state="hidden", timeout=5000)
            overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
            assert not overflow, f"horizontal overflow: {path} at {width}px"
            unnamed = page.locator("input:not([type=file]), textarea, select").evaluate_all("els => els.filter(e => !e.getAttribute('aria-label') && !e.labels?.length).map(e => e.outerHTML.slice(0, 100))")
            assert not unnamed, f"unnamed fields: {path}: {unnamed}"
            if path.startswith("admin/settings/delivery/"):
                assert page.get_by_text("Что работает сейчас").is_visible()
                assert page.get_by_text("Что нужно сделать продавцу").is_visible()
                assert page.get_by_text("Что уже связано с заказом" if path.endswith("/cdek") else "Что приложение будет делать само").is_visible()
                if width == 375:
                    page.screenshot(path=f"/tmp/shmotki-delivery-guide-{path.rsplit('/', 1)[-1]}.png", full_page=True)
                page.get_by_text("Показать подробные шаги").click()
                assert page.locator(".delivery-guide-steps li").count() == 4
            if path == "admin/products":
                page.locator(".admin-product-card").first.wait_for()
                assert page.locator(".admin-product-select").first.bounding_box()["width"] >= 44
                for selector in (".tabs .chip", ".admin-product-actions .chip"):
                    for button in page.locator(selector).all():
                        box = button.bounding_box()
                        assert box and box["x"] >= 0 and box["x"] + box["width"] <= width, f"clipped {button.inner_text()} at {width}px"
                for button in page.locator(".tabs .chip").all():
                    button.click()
                    assert "active" in button.get_attribute("class"), "status filter did not activate"
                page.locator(".admin-product-card").first.wait_for()
                page.get_by_role("checkbox", name=f"Выбрать {product['title']}").check()
                assert page.get_by_role("button", name="Архивировать выбранные").is_visible()
                if width == 375:
                    page.screenshot(path="/tmp/shmotki-admin-products-mobile.png", full_page=True)
            if path == "admin" and width == 375:
                page.get_by_role("link", name="Новые заявки Ожидают вашего решения").wait_for()
                page.screenshot(path="/tmp/shmotki-overview-mobile.png", full_page=True)
            if path == "profile" and width == 375:
                page.get_by_role("button", name="Изменить").click()
                page.get_by_label("ФИО").fill("Тестовый покупатель")
                page.get_by_label("Почта").fill("buyer@example.org")
                page.get_by_role("button", name="Сохранить").click()
                assert profile["contactName"] == "Тестовый покупатель"
                assert profile["contactEmail"] == "buyer@example.org"
            if path == "admin/products/p1":
                page.get_by_label("Состояние").wait_for()
                assert page.locator(".select-wrap select").evaluate_all("els => els.every(e => getComputedStyle(e).appearance === 'none')")
                page.get_by_label("Состояние").select_option("excellent")
                assert page.get_by_label("Состояние").input_value() == "excellent"
                if width == 375:
                    page.screenshot(path="/tmp/shmotki-product-editor-mobile.png", full_page=True)
                defects = page.get_by_label("Дефекты")
                defects.scroll_into_view_if_needed()
                field = defects.bounding_box()
                bar = page.locator(".admin-view .bar").bounding_box()
                assert field and bar and field["y"] + field["height"] <= bar["y"], f"last field obscured by fixed actions at {width}px"
        page.goto(BASE + "admin/orders")
        page.get_by_text("Покупателю", exact=True).wait_for()
        squeezed = page.locator(".order-actions .btn").evaluate_all("els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent)")
        assert not squeezed, f"squeezed order buttons at {width}px: {squeezed}"
        if width == 375:
            page.screenshot(path="/tmp/shmotki-admin-orders-mobile.png", full_page=True)
            page.goto(BASE)
            page.get_by_role("link", name="Каталог").wait_for()
            page.screenshot(path="/tmp/shmotki-home-mobile.png", full_page=True)
        context.close()

    context = browser.new_context(viewport={"width": 375, "height": 812})
    page = context.new_page()
    page.route("https://telegram.org/js/**", lambda route: route.abort())
    page.route("**/shmotki/api/**", route_api)
    page.goto(BASE + "admin")
    page.locator(".loader").wait_for(state="hidden")
    page.get_by_role("link", name="Открыть витрину магазина").click()
    page.get_by_role("link", name="Каталог").click()
    assert page.url.endswith("/catalog"), "catalog cannot reopen after overview"
    page.get_by_role("button", name="Фильтры").click()
    assert page.get_by_role("dialog", name="Фильтры").is_visible()
    page.keyboard.press("Escape")
    assert not page.get_by_role("dialog", name="Фильтры").count()
    page.goto(BASE + "admin/products/p1")
    page.get_by_role("button", name="Сохранить изменения").wait_for()
    assert not page.get_by_role("button", name="Опубликовать").count()
    page.goto(BASE + "orders")
    page.get_by_text("Отзыв оставлен").wait_for()
    assert page.get_by_role("button", name="Оставить отзыв").count() == 1
    page.get_by_role("button", name="Оставить отзыв").click()
    assert page.get_by_role("dialog", name="Отзыв по заказу №TEST03").is_visible()
    page.keyboard.press("Escape")
    assert not page.get_by_role("dialog").count()
    page.goto(BASE + "product/p1")
    page.get_by_label("Размер").select_option("v1")
    page.get_by_label("Количество").fill("2")
    page.get_by_role("button", name="В корзину").click()
    page.get_by_text("Корзина", exact=True).first.wait_for()
    page.screenshot(path="/tmp/shmotki-cart-new.png", full_page=True)
    page.get_by_role("link", name="Оформить заявку").click()
    page.get_by_text("2 шт.").wait_for()
    page.screenshot(path="/tmp/shmotki-checkout-new.png", full_page=True)
    assert "/checkout" in page.url, "cart did not open checkout"
    page.get_by_role("textbox", name="ФИО").fill("Тестовый покупатель")
    page.get_by_role("textbox", name="Телефон").fill("+79991234567")
    page.get_by_role("textbox", name="Почта").fill("buyer@example.org")
    page.get_by_role("button", name="Продолжить").click()
    page.get_by_role("button", name="Продолжить").click()
    page.get_by_role("checkbox", name="Даю отдельное согласие").check()
    page.get_by_role("checkbox", name="Ознакомился с").check()
    page.get_by_role("button", name="Отправить заявку").click()
    page.get_by_text("Заявка №TEST01 отправлена").wait_for()
    assert order_requests[-1]["items"][0]["quantity"] == 2, "checkout did not send cart quantity"
    assert order_requests[-1]["consent"] and order_requests[-1]["termsAccepted"], "checkout did not send both legal decisions"
    page.get_by_role("button", name="Чат с продавцом").click()
    assert "/chat" in page.url, "order success did not open in-app chat"
    page.get_by_role("textbox", name="Текст сообщения").fill("Можно встретиться завтра?")
    page.get_by_role("button", name="Отправить сообщение").click()
    page.get_by_text("Можно встретиться завтра?").wait_for()
    page.locator(".chat-composer input[type=file]").set_input_files({"name": "test.mp4", "mimeType": "video/mp4", "buffer": b"0000ftyp"})
    page.get_by_text("Видео прикреплено").wait_for()
    page.get_by_role("button", name="Отправить сообщение").click()
    page.locator(".chat-message video").wait_for()
    page.goto(BASE + "admin/chats")
    page.get_by_role("link", name="Покупатель").click()
    page.get_by_role("textbox", name="Текст сообщения").fill("Да, договоримся здесь")
    page.get_by_role("button", name="Отправить сообщение").click()
    page.get_by_text("Да, договоримся здесь").wait_for()
    page.screenshot(path="/tmp/shmotki-admin-chat-mobile.png")
    page.goto(BASE + "chat")
    page.get_by_text("Да, договоримся здесь").wait_for()
    page.screenshot(path="/tmp/shmotki-buyer-chat-mobile.png")
    page.goto(BASE + "checkout/p1")
    page.get_by_label("ФИО").fill("Тестовый покупатель")
    page.get_by_label("Телефон").fill("+79991234567")
    page.get_by_label("Почта").fill("buyer@example.org")
    page.get_by_role("button", name="Продолжить").click()
    page.get_by_role("button", name="Яндекс Доставка", exact=True).click()
    page.get_by_label("Город").fill("Москва")
    page.get_by_text("продавец пока не добавил пункты выдачи", exact=False).wait_for()
    page.get_by_role("button", name="СДЭК", exact=True).click()
    page.get_by_label("Город").fill("Моск")
    page.get_by_role("button", name="Москва Московская область").click()
    page.get_by_role("region", name="Карта пунктов выдачи").wait_for()
    page.wait_for_timeout(1800)
    page.screenshot(path="/tmp/shmotki-checkout-map-mobile.png", full_page=True)
    page.locator(".delivery-map-pin").first.click()
    page.get_by_text("Посылка ПВЗ—ПВЗ · 420 ₽", exact=False).wait_for()
    page.screenshot(path="/tmp/shmotki-checkout-cdek-mobile.png", full_page=True)
    page.get_by_role("button", name="Продолжить").click()
    assert page.get_by_text("Проверьте заявку").is_visible()
    page.get_by_role("checkbox", name="Даю отдельное согласие").check()
    page.get_by_role("checkbox", name="Ознакомился с").check()
    page.get_by_role("button", name="Отправить заявку").click()
    assert order_requests[-1]["deliveryPointCode"] == "MSK1" and order_requests[-1]["deliveryCityCode"] == 44 and order_requests[-1]["buyerEmail"] == "buyer@example.org" and order_requests[-1]["expectedDeliveryPrice"] == 420 and order_requests[-1]["expectedTariffCode"] == 136
    store["settings"]["cdekMode"] = "manual"
    page.goto(BASE + "checkout/p1")
    page.get_by_role("textbox", name="ФИО").fill("Тестовый покупатель")
    page.get_by_role("textbox", name="Телефон").fill("+79991234567")
    page.get_by_role("textbox", name="Почта").fill("buyer@example.org")
    page.get_by_role("button", name="Продолжить").click()
    page.get_by_role("button", name="СДЭК", exact=True).click()
    page.get_by_label("Город").fill("Моск")
    page.get_by_role("button", name="Москва Московская область").click()
    page.locator(".checkout-point").first.click()
    page.get_by_text("Стоимость уточнит продавец").wait_for()
    page.get_by_role("button", name="Продолжить").click()
    page.get_by_role("checkbox", name="Даю отдельное согласие").check()
    page.get_by_role("checkbox", name="Ознакомился с").check()
    page.get_by_role("button", name="Отправить заявку").click()
    assert order_requests[-1]["deliveryPointCode"] == "MSK1" and not order_requests[-1].get("expectedDeliveryPrice"), "manual CDEK sent an automatic tariff"
    store["settings"]["cdekMode"] = "automatic"
    saved_order = deepcopy(order)
    order.update({"deliveryMethod": "cdek", "deliveryTariff": "Ручное оформление", "deliveryPrice": None, "status": "confirmed"})
    page.goto(BASE + "admin/orders")
    page.get_by_label("Стоимость доставки, ₽").fill("450")
    assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth"), "manual delivery controls overflow mobile"
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Сообщить покупателю").click()
    page.get_by_text("С покупателя всего: 2 950 ₽").wait_for()
    order.clear()
    order.update(saved_order)
    page.route("**/shmotki/api/delivery/cdek/status*", lambda route: route.fulfill(status=200, content_type="application/json", body='{"connected":false}'))
    page.goto(BASE + "checkout/p1")
    page.get_by_role("textbox", name="ФИО").fill("Тестовый покупатель")
    page.get_by_role("textbox", name="Телефон").fill("+79991234567")
    page.get_by_role("textbox", name="Почта").fill("buyer@example.org")
    page.get_by_role("button", name="Продолжить").click()
    page.get_by_role("button", name="СДЭК", exact=True).click()
    page.get_by_label("Город").fill("Тверь")
    page.get_by_label("Адрес или желаемый ПВЗ").fill("СДЭК, Советская, 1")
    page.get_by_role("button", name="Продолжить").click()
    page.get_by_role("checkbox", name="Даю отдельное согласие").check()
    page.get_by_role("checkbox", name="Ознакомился с").check()
    page.get_by_role("button", name="Отправить заявку").click()
    assert order_requests[-1]["deliveryAddress"] == "СДЭК, Советская, 1" and not order_requests[-1].get("deliveryPointCode"), "manual fallback did not preserve desired PVZ"
    page.unroute("**/shmotki/api/delivery/cdek/status*")
    page.goto(BASE + "admin/orders")
    page.get_by_role("button", name="Принять").wait_for()
    page.once("dialog", lambda dialog: dialog.accept())
    page.get_by_role("button", name="Принять").click()
    assert order_actions and order_actions[-1].endswith("/accept")
    page.goto(BASE + "admin/settings?store=nikita")
    page.get_by_role("link", name="СДЭК Подключить кабинет и проверить ключи").click()
    assert page.url.endswith("/admin/settings/delivery/cdek?store=nikita"), "delivery guide did not keep store context"
    page.get_by_label("Идентификатор аккаунта (client_id)").fill("demo-client")
    page.get_by_label("Секретный ключ (client_secret)").fill("demo-secret")
    page.get_by_label("Город сдачи посылок").fill("Москва")
    page.get_by_role("button", name="Москва Московская область").wait_for()
    page.get_by_role("button", name="Москва Московская область").click()
    page.get_by_label("Пункт, куда вы сдадите посылку").select_option("MSK1")
    page.get_by_label("Телефон отправителя").fill("+79991234567")
    page.get_by_role("button", name="Проверить и сохранить").click()
    page.get_by_text("Ключи проверены · тестовая среда").wait_for()
    page.get_by_role("link", name="К настройкам доставки").click()
    assert page.url.endswith("/admin/settings?store=nikita"), "delivery guide back link failed"
    page.get_by_role("textbox", name="Название магазина").fill("Несохранённое название")
    page.get_by_role("button", name="DHL").click()
    page.get_by_role("button", name="Изменить точку на карте").first.click()
    page.get_by_role("region", name="Карта пунктов выдачи").wait_for()
    page.locator(".delivery-editor-map .delivery-map").click(position={"x": 135, "y": 120})
    assert page.get_by_role("spinbutton", name="Широта точки").input_value(), "seller cannot set point on map"
    page.screenshot(path="/tmp/shmotki-settings-delivery-mobile.png", full_page=True)
    page.get_by_role("textbox", name="Telegram ID сотрудника").fill("456")
    page.get_by_role("button", name="Добавить", exact=True).click()
    page.get_by_text("Сотрудник", exact=True).wait_for()
    assert page.get_by_role("textbox", name="Название магазина").input_value() == "Несохранённое название", "adding a member lost unsaved settings"
    page.get_by_role("textbox", name="Адрес магазина").fill("pullinup")
    page.get_by_role("button", name="Сохранить настройки").click()
    page.get_by_text("Несохранённое название", exact=True).wait_for()
    assert "dhl" in store["settings"]["deliveryMethods"] and store["settings"]["deliveryOptions"][0]["lat"], "delivery settings were not saved"
    assert seen_store_slugs[-1] == "pullinup", f"slug was not updated: {seen_store_slugs[-1]}"
    context.close()

    manager = browser.new_context(viewport={"width": 375, "height": 812})
    manager_page = manager.new_page()
    manager_page.route("https://telegram.org/js/**", lambda route: route.abort())
    manager_page.route("**/shmotki/api/**", route_api)
    manager_page.route("**/shmotki/api/profile*", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"user": {"id": "u2", "firstName": "Менеджер"}, "ordersCount": 0, "stores": [{"id": "s1", "role": "manager"}]})))
    manager_page.goto(BASE + "admin/settings/delivery/cdek")
    manager_page.get_by_text("Подключать ключи перевозчика может только владелец магазина").wait_for()
    assert not manager_page.get_by_label("Секретный ключ (client_secret)").count(), "manager sees owner-only key form"
    manager.close()

    dark = browser.new_context(viewport={"width": 375, "height": 812}, color_scheme="dark", reduced_motion="reduce")
    dark_page = dark.new_page()
    dark_page.route("https://telegram.org/js/**", lambda route: route.abort())
    dark_page.route("**/shmotki/api/**", route_api)
    dark_page.goto(BASE + "admin/orders")
    dark_page.get_by_role("button", name="Принять").wait_for()
    assert not dark_page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    dark_page.screenshot(path="/tmp/shmotki-admin-orders-dark.png", full_page=True)
    dark.close()

    offline = browser.new_context(viewport={"width": 375, "height": 812})
    offline_page = offline.new_page()
    offline_page.route("https://telegram.org/js/**", lambda route: route.abort())
    offline_page.route("**/shmotki/api/**", route_api)
    failures = [0]
    def fail_once(route):
        failures[0] += 1
        if failures[0] == 1:
            route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": {"code": "offline", "message": "Временная ошибка сети"}}))
        else:
            route_api(route)
    offline_page.route("**/shmotki/api/catalog?*", fail_once)
    offline_page.goto(BASE + "catalog")
    offline_page.get_by_text("Временная ошибка сети").wait_for()
    offline_page.get_by_role("button", name="Повторить").click()
    offline_page.get_by_text("Найдено: 1").wait_for()
    offline.close()
    browser.close()

    safari = playwright.webkit.launch(headless=True)
    ios = safari.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=3, is_mobile=True, has_touch=True, color_scheme="dark")
    ios_page = ios.new_page()
    ios_page.route("https://telegram.org/js/**", lambda route: route.abort())
    ios_page.route("**/shmotki/api/**", route_api)
    ios_page.goto(BASE + "admin/products")
    ios_page.locator(".admin-product-card").first.wait_for()
    assert not ios_page.evaluate("document.documentElement.scrollWidth > window.innerWidth"), "iOS catalog overflows"
    ios_page.screenshot(path="/tmp/shmotki-admin-products-webkit.png", full_page=True)
    ios_page.goto(BASE + "admin/products/p1")
    ios_page.get_by_label("Категория").wait_for()
    assert ios_page.get_by_label("Категория").evaluate("e => getComputedStyle(e).appearance") == "none"
    ios_page.screenshot(path="/tmp/shmotki-product-editor-webkit.png", full_page=True)
    ios_page.get_by_label("Дефекты").scroll_into_view_if_needed()
    field = ios_page.get_by_label("Дефекты").bounding_box()
    bar = ios_page.locator(".admin-view .bar").bounding_box()
    assert field and bar and field["y"] + field["height"] <= bar["y"], "iOS last field obscured by fixed actions"
    ios_page.goto(BASE + "checkout/p1")
    ios_page.get_by_role("textbox", name="ФИО").fill("Тест")
    ios_page.get_by_role("textbox", name="Телефон").fill("+79991234567")
    ios_page.get_by_role("textbox", name="Почта").fill("buyer@example.org")
    ios_page.get_by_role("button", name="Продолжить").click()
    ios_page.get_by_role("button", name="СДЭК", exact=True).click()
    ios_page.get_by_label("Город").fill("Моск")
    ios_page.get_by_role("button", name="Москва Московская область").click()
    ios_page.get_by_role("region", name="Карта пунктов выдачи").wait_for()
    ios_page.locator(".checkout-point").first.click()
    ios_page.wait_for_timeout(1800)
    assert not ios_page.evaluate("document.documentElement.scrollWidth > window.innerWidth"), "iOS checkout map overflows"
    ios_page.screenshot(path="/tmp/shmotki-checkout-map-webkit.png", full_page=True)
    ios.close()
    safari.close()

print("UI smoke passed: mobile screens at 320/375/667px, WebKit touch viewport, in-app chat buyer/seller, checkout, orders, admin controls, network retry")
