# UPCI Alert — édition serveur. Image minimale : PHP 8 + Apache + SQLite.
FROM php:8.2-apache

RUN apt-get update \
 && apt-get install -y --no-install-recommends libsqlite3-dev \
 && docker-php-ext-install pdo_sqlite \
 && rm -rf /var/lib/apt/lists/*

COPY . /var/www/html/

# Le dossier data/ doit être inscriptible par Apache (base SQLite + sauvegardes).
RUN chown -R www-data:www-data /var/www/html/data \
 && chmod 775 /var/www/html/data

EXPOSE 80
