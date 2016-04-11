# websaver
Extensible web content downloader

### Installation

From npm

[![NPM](https://nodei.co/npm/websaver.png)](https://npmjs.org/package/websaver)

```
npm install -g websaver
```

From source

```
git clone https://github.com/jul11co/websaver.git
npm install -g websaver/
```

### Usage

```
Download page to local directory
    websaver download <page_url> <output_dir> [--force]
    
Update local directory
    websaver update <output_dir> [--force]
    

Add page to download list
    websaver add-page <page_url> <output_dir>

Enable page to download
    websaver enable-page <page_url> <output_dir>

Disable page from download
    websaver disable-page <page_url> <output_dir>
    

Download images
    websaver download-image <page_url> <output_dir> [SELECTOR]

Download video (using youtube-dl)
	websaver download-video <page_url> <output_dir>
    
    
Run script
    websaver run-script <SCRIPT-FILE> <page_url> <output_dir>
```

### Customize

Write [EJS](https://github.com/mde/ejs) script and run it with

```
websaver run-script <SCRIPT-FILE> <page_url> <output_dir>
```

### License

Licensed under the Apache License, Version 2.0
(<http://www.apache.org/licenses/LICENSE-2.0>)
