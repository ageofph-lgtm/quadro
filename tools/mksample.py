import random, io, sys
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
random.seed(3)
W,H=1325,2037
try:
    F=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",44)
    BIG=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",160)
except: F=BIG=ImageFont.load_default()
pal=[(232,76,61),(52,152,219),(241,196,15),(46,204,113),(155,89,182),(230,126,34),(26,188,156)]
def page(n,w=W,h=H):
    im=Image.new("RGB",(w,h),(250,248,240)); d=ImageDraw.Draw(im)
    m=50; g=30; rows=3
    rh=(h-2*m-(rows-1)*g)//rows
    for r in range(rows):
        cols=random.choice([1,2,2,3]) if w<h*1.2 else random.choice([2,3,4])
        cw=(w-2*m-(cols-1)*g)//cols
        for c in range(cols):
            x=m+c*(cw+g); y=m+r*(rh+g)
            col=random.choice(pal)
            d.rectangle([x,y,x+cw,y+rh],fill=tuple(int(v*0.55+110) for v in col),outline=(20,20,20),width=8)
            for _ in range(4):
                cx=random.randint(x+40,x+cw-40); cy=random.randint(y+rh//2,y+rh-30); rr=random.randint(30,90)
                d.ellipse([cx-rr,cy-rr,cx+rr,cy+rr],fill=col,outline=(20,20,20),width=5)
            bw=min(cw-60,360); bx=x+30; by=y+30
            d.rounded_rectangle([bx,by,bx+bw,by+120],radius=50,fill="white",outline="black",width=5)
            d.text((bx+30,by+35),random.choice(["POW!","Olá parça!","E agora?","Corre!!","Hmm..."]),fill="black",font=F)
    d.text((w//2-120,h//2-100),str(n),fill=(0,0,0),font=BIG,stroke_width=6,stroke_fill="white")
    return im
c=canvas.Canvas(sys.argv[1])
pages=[("CAPA",W,H)]+[(i,W,H) for i in range(1,5)]+[("5-6",W*2,H)]+[(i,W,H) for i in range(7,12)]
for n,w,h in pages:
    im=page(n,w,h); b=io.BytesIO(); im.save(b,"JPEG",quality=85); b.seek(0)
    c.setPageSize((w*0.36,h*0.36)); c.drawImage(ImageReader(b),0,0,w*0.36,h*0.36); c.showPage()
c.save()
