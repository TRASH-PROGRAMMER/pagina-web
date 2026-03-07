# Imagen base ligera de Python
FROM python:3.11-slim

# Evitar archivos .pyc y buffer
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Directorio de trabajo
WORKDIR /app

# Copiar requirements primero (mejor cache de capas)
COPY requirements.txt .

# Instalar dependencias
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código del servidor
COPY SEVER/ ./SEVER/
COPY .ENV .ENV

# Exponer puerto (Flask usa 5000 por defecto)
EXPOSE 5000

# Comando para ejecutar la app
CMD ["python", "SEVER/app.py"]
