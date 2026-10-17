'use strict';

/* Small offline QR Code generator (byte mode, error-correction level M, versions 1-10).
   No external library or internet is needed. Usage: qrSvg('text', 200) -> SVG string. */
(function(){
    const ECC=[10,16,26,18,24,16,18,22,22,26],BLK=[1,1,1,2,2,4,4,4,5,5];   // level M, versions 1..10
    const ALIGN=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];

    const rawModules=v=>{
        let r=(16*v+128)*v+64;
        if(v>=2){
            const n=Math.floor(v/7)+2;
            r-=(25*n-10)*n-55;
            if(v>=7)r-=36
        }
        return r
    };

    const rawCw=v=>Math.floor(rawModules(v)/8),dataCw=v=>rawCw(v)-ECC[v-1]*BLK[v-1];

    const bit=(x,i)=>((x>>>i)&1)!==0;

    function gfMul(x,y){
        let z=0;
        for(let i=7;i>=0;i--){
            z=(z<<1)^((z>>>7)*0x11D);
            z^=((y>>>i)&1)*x
        }
        return z&255
    }

    function rsDivisor(d){
        const r=new Array(d).fill(0);
        r[d-1]=1;
        let root=1;

        for(let i=0;i<d;i++){
            for(let j=0;j<d;j++){
                r[j]=gfMul(r[j],root);
                if(j+1<d)r[j]^=r[j+1]
            }
            root=gfMul(root,2)
        }

        return r
    }

    function rsRemainder(data,div){
        const r=div.map(()=>0);

        for(const b of data){
            const f=b^r.shift();
            r.push(0);
            div.forEach((c,i)=>r[i]^=gfMul(c,f))
        }

        return r
    }

    function makeCodewords(bytes,v){
        const cap=dataCw(v)*8,bits=[];
        const put=(val,n)=>{
            for(let i=n-1;i>=0;i--)bits.push((val>>>i)&1)
        };

        put(4,4);
        put(bytes.length,v<10?8:16);
        bytes.forEach(b=>put(b,8));

        put(0,Math.min(4,cap-bits.length));

        while(bits.length%8)bits.push(0);

        for(let p=0xEC;bits.length<cap;p^=0xEC^0x11)put(p,8);

        const data=[];

        for(let i=0;i<bits.length;i+=8){
            data.push(parseInt(bits.slice(i,i+8).join(''),2))
        }

        const nb=BLK[v-1],el=ECC[v-1],raw=rawCw(v),short=nb-raw%nb,shortLen=Math.floor(raw/nb),div=rsDivisor(el),blocks=[];

        for(let i=0,k=0;i<nb;i++){
            const len=shortLen-el+(i<short?0:1);
            const dat=data.slice(k,k+len);
            k+=len;

            const ecc=rsRemainder(dat,div);

            if(i<short)dat.push(0);

            blocks.push(dat.concat(ecc))
        }

        const out=[];

        for(let i=0;i<blocks[0].length;i++){
            blocks.forEach((b,j)=>{
                if(i!==shortLen-el||j>=short)out.push(b[i])
            })
        }

        return out
    }

    function build(bytes){
        let v=1;

        while(v<=10&&4+(v<10?8:16)+bytes.length*8>dataCw(v)*8)v++;

        if(v>10)throw new Error('QR text too long');

        const size=v*4+17,m=[...Array(size)].map(()=>Array(size).fill(false)),fn=[...Array(size)].map(()=>Array(size).fill(false));

        const set=(x,y,c)=>{
            m[y][x]=c;
            fn[y][x]=true
        };

        for(let i=0;i<size;i++){
            set(6,i,i%2===0);
            set(i,6,i%2===0)
        }

        const finder=(cx,cy)=>{
            for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
                const d=Math.max(Math.abs(dx),Math.abs(dy)),x=cx+dx,y=cy+dy;

                if(x>=0&&x<size&&y>=0&&y<size)set(x,y,d!==2&&d!==4)
            }
        };

        finder(3,3);
        finder(size-4,3);
        finder(3,size-4);

        const al=ALIGN[v-1],n=al.length;

        for(let i=0;i<n;i++)for(let j=0;j<n;j++){
            if((i===0&&j===0)||(i===0&&j===n-1)||(i===n-1&&j===0))continue;

            for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
                set(al[i]+dx,al[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1)
            }
        }

        const fmt=mask=>{
            let r=mask;

            for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);

            const b=((mask<<10)|r)^0x5412;

            for(let i=0;i<=5;i++)set(8,i,bit(b,i));

            set(8,7,bit(b,6));
            set(8,8,bit(b,7));
            set(7,8,bit(b,8));

            for(let i=9;i<15;i++)set(14-i,8,bit(b,i));

            for(let i=0;i<8;i++)set(size-1-i,8,bit(b,i));

            for(let i=8;i<15;i++)set(8,size-15+i,bit(b,i));

            set(8,size-8,true)
        };

        fmt(0);

        if(v>=7){
            let r=v;

            for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);

            const b=(v<<12)|r;

            for(let i=0;i<18;i++){
                const c=bit(b,i),a=size-11+i%3,q=Math.floor(i/3);

                set(a,q,c);
                set(q,a,c)
            }
        }

        const cw=makeCodewords(bytes,v);
        let k=0;

        for(let right=size-1;right>=1;right-=2){
            if(right===6)right=5;

            for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){
                const x=right-j,up=((right+1)&2)===0,y=up?size-1-vert:vert;

                if(!fn[y][x]&&k<cw.length*8){
                    m[y][x]=bit(cw[k>>>3],7-(k&7));
                    k++
                }
            }
        }

        const MASK=[
            (x,y)=>(x+y)%2===0,
            (x,y)=>y%2===0,
            (x,y)=>x%3===0,
            (x,y)=>(x+y)%3===0,
            (x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,
            (x,y)=>x*y%2+x*y%3===0,
            (x,y)=>(x*y%2+x*y%3)%2===0,
            (x,y)=>((x+y)%2+x*y%3)%2===0
        ];

        const apply=t=>{
            for(let y=0;y<size;y++)for(let x=0;x<size;x++)
                if(!fn[y][x]&&MASK[t](x,y))m[y][x]=!m[y][x]
        };

        const penalty=()=>{
            let p=0;

            const line=g=>{
                let run=1;

                for(let i=1;i<size;i++){
                    if(g(i)===g(i-1)){
                        run++;

                        if(run===5)p+=3;
                        else if(run>5)p++
                    }else run=1
                }
            };

            for(let y=0;y<size;y++)line(i=>m[y][i]);
            for(let x=0;x<size;x++)line(i=>m[i][x]);

            for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++)
                if(m[y][x]===m[y][x+1]&&m[y][x]===m[y+1][x]&&m[y][x]===m[y+1][x+1])p+=3;

            const dark=m.flat().filter(Boolean).length;

            p+=Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;

            return p
        };

        let best=0,bp=1e9;

        for(let t=0;t<8;t++){
            apply(t);
            fmt(t);

            const p=penalty();

            if(p<bp){
                bp=p;
                best=t
            }

            apply(t)
        }

        apply(best);
        fmt(best);

        return m
    }

    function qrMatrix(text){
        return build(Array.from(new TextEncoder().encode(text)))
    }

    function qrSvg(text,px=200,fg='#0b3a5b'){
        const m=qrMatrix(text),q=4,s=m.length+q*2;
        let d='';

        m.forEach((row,y)=>row.forEach((c,x)=>{
            if(c)d+=`M${x+q} ${y+q}h1v1h-1z`
        }));

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="${fg}"/></svg>`
    }

    if(typeof module!=='undefined')module.exports={qrMatrix,qrSvg};
    else window.qrSvg=qrSvg;
})();