# MaxBot

MAX Mini App и backend MAX-бота.

После установки Mini App подключается к боту, токен которого был указан при настройке.

## Требования к серверу

Для развёртывания понадобится:

- VPS с Ubuntu 22.04 или 24.04 и публичным IPv4-адресом.
- Доменное имя с A-записью, указывающей на IPv4-адрес VPS.
- Открытые входящие TCP-порты 80 и 443.
- Docker Engine и Docker Compose v2.
- Токен MAX-бота.

Перед установкой убедитесь, что DNS-запись домена уже обновилась и домен указывает на IP-адрес VPS.

## Установка

### 1. Установите Git, если он ещё не установлен

```bash
sudo apt update
sudo apt install -y git
```

### 2. Установите Docker, если он ещё не установлен

Проверьте, установлены ли Docker Engine и Docker Compose v2:

```bash
docker --version
docker compose version
```

Если одной из команд нет, установите Docker и Compose:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
```

### 3. Клонируйте репозиторий

```bash
git clone https://github.com/PLauncher-Team/MaxBot.git
cd MaxBot
```

### 4. Запустите установщик

Из корневой папки проекта выполните:

```bash
sudo bash setup.sh
```

Установщик запросит токен MAX-бота и доменное имя. Вводите домен без `https://` и `http://`, например `mybot.example.com`. Токен будет сохранён на сервере в отдельном файле с ограниченными правами доступа. Установщик соберёт Docker-образы, запустит Nginx, запросит TLS-сертификат Let's Encrypt и запустит приложение.

После успешной установки приложение будет доступно по адресу:

```
https://ваш-домен
```

Для получения сертификата Let's Encrypt домен должен указывать на VPS, а входящий TCP-порт 80 должен быть доступен из интернета.

### 5. Укажите домен в панели MAX

В настройках MAX-бота укажите домен развёрнутого веб-приложения (полный URL с `https://`) и сохраните изменения. После этого Mini App готово к тестированию.

## Управление

Все команды запускаются из корневой папки проекта (`MaxBot`).

```bash
bash maxbot status   # Проверить состояние контейнеров
bash maxbot logs     # Посмотреть логи в реальном времени
bash maxbot restart  # Перезапустить сервисы
bash maxbot update   # Обновить приложение
bash maxbot stop     # Остановить проект
bash maxbot clear-db # Очистить БД с подтверждением
bash maxbot uninstall # Удалить контейнеры и папку MaxBot
```
