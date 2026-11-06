# Развёртывание MAXBot

## Требования к жюри

- VPS на Ubuntu 22.04/24.04 с публичным IPv4.
- Домен с A-записью на IPv4 VPS.
- Открытые входящие TCP-порты 80 и 443.
- Установленные Docker Engine и Docker Compose v2.
- Токен MAX-бота.

## Установка

Из корня комплекта выполните:

```bash
sudo bash deploy/setup.sh
```

Мастер запросит токен и домен, сохранит токен локально с правами 600, получит сертификат Let's Encrypt и запустит приложение по адресу `https://ваш-домен`.

## Управление

```bash
bash deploy/maxbot status
bash deploy/maxbot logs
bash deploy/maxbot restart
bash deploy/maxbot update
bash deploy/maxbot backup
bash deploy/maxbot stop
```

SQLite и загруженные файлы сохраняются в Docker volume. Не удаляйте volumes при обновлении.

Let's Encrypt требует доступности домена по TCP 80. Проверка и продление сертификата автоматически запускаются systemd timer дважды в сутки. Корневой сертификат Минцифры внутри приложения используется для исходящих HTTPS-запросов к MAX и не является сертификатом сайта.
