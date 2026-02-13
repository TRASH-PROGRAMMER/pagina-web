from flask import Flask,render_template
 
app = Flask(__name__)
 
@app.route('/')
def home():
    return render_template('index.html')

print("El programa está funcionando")

if __name__ == '__main__':
    app.run(debug=True)