var bransDB = []

const loadDB = async () => {
    const response = await fetch('databases/notion_database.json');
    const jsonData = await response.json();
    brandsDB = jsonData
}

const renderTable = (brandsDB) => {
    const brandsTable = document.getElementById('brands-table')
    brandsTable.innerHTML = ''
    for (const brand of brandsDB) {
        const brandDiv = document.createElement('div')
        brandDiv.classList.add('brand-div')
        const brandName = document.createElement('h3')
        brandName.textContent = brand.companyName
        brandDiv.appendChild(brandName)
        const explanation = document.createElement('p')
        explanation.textContent = brand.explanation
        brandDiv.appendChild(explanation)
        if (brand.subbrands.length > 0) {
            const subbrandsTitle = document.createElement('h4')
            subbrandsTitle.textContent = `Otras marcas que pertenecen a ${brand.companyName}`
            brandDiv.appendChild(subbrandsTitle)
            const subbrands = document.createElement('ul')
            for (const subbrand of brand.subbrands) {
                if (subbrand === '') continue
                const subbrandLi = document.createElement('li')
                subbrandLi.textContent = subbrand
                subbrands.appendChild(subbrandLi)
            }
            brandDiv.appendChild(subbrands)
        }
        brandsTable.appendChild(brandDiv)
    }
}

const searchBrands = () => {
    const searchInput = document.getElementById('search-input')
    const searchValue = searchInput.value
    const filteredBrands = []
    for (const brand of Object.values(brandsDB)) {
        if (brand.companyName.toLowerCase().includes(searchValue.toLowerCase())) {
            filteredBrands.push(brand)
        }
        for (const subbrand of brand.subbrands) {
            if (subbrand.toLowerCase().includes(searchValue.toLowerCase())) {
                filteredBrands.push(brand)
                break
            }
        }
    }
    renderTable(filteredBrands)
}

const openBrands = () => {
    window.open('brands_list.html', '_self')
}

window.onload = async () => {
    await loadDB()
    renderTable(Object.values(brandsDB))
    const searchInput = document.getElementById('search-input')
    searchInput.addEventListener('input', searchBrands)
}