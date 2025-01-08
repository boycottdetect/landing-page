var bransDB = []

const loadDB = async () => {
    const response = await fetch('databases/notion_database.json');
    const jsonData = await response.json();
    brandsDB = jsonData
}

const renderTable = (brands) => {
    const brandsTable = document.getElementById('brands-table')
    for (const brand of Object.values(brands)) {
        console.log(brand)
        const brandDiv = document.createElement('div')
        brandDiv.classList.add('brand-div')
        const brandName = document.createElement('h3')
        brandName.textContent = brand.companyName
        brandDiv.appendChild(brandName)
        const explanation = document.createElement('p')
        explanation.textContent = brand.explanation
        brandDiv.appendChild(explanation)
        brandsTable.appendChild(brandDiv)
        if (brand.subbrands.length === 0) {
            continue
        }
        const subbrandsTitle = document.createElement('h4')
        subbrandsTitle.textContent = `Otras marcas que pertenecen a ${brand.companyName}`
        brandDiv.appendChild(subbrandsTitle)
        const subbrands = document.createElement('ul')
        for (const subbrand of brand.subbrands) {
            const subbrandLi = document.createElement('li')
            subbrandLi.textContent = subbrand
            subbrands.appendChild(subbrandLi)
        }
        brandDiv.appendChild(subbrands)
    }
}

window.onload = async () => {
    await loadDB()
    console.log("BRANDS DB", brandsDB)
    renderTable(brandsDB)
}