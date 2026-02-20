from flask import Flask,render_template
 # crea una nueva aplicación Flask
app = Flask(__name__)
 # crea una ruta para la página principal
@app.route('/')
def home():
    return render_template('index.html')

# crea una ruta para la página de administración
@app.route('/admin')
def admin():
    return render_template('admin.html')
# imprime un mensaje en la consola para indicar que el programa está funcionando
print("El programa está funcionando")
# inicia la aplicación Flask en modo de depuración
if __name__ == '__main__':
    app.run(debug=True)