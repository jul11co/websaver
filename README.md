# websaver
Extensible web content downloader

####Install
```
git clone https://github.com/jul11co/websaver.git
npm install -g websaver/
```

####Usage
```
Download page to local directory
    websaver download <page_url> <output_dir> [--force]
    
Update local directory
    websaver update <output_dir>
    
Add page to download list (into state file in parent directory)
    websaver add-page <page_url> <output_dir>
    
Download images to local directory
    websaver download-image <page_url> <output_dir> [SELECTOR]
    
Run script
    websaver run-script <SCRIPT-FILE> <page_url> <output_dir>
```

####Customize

Write script and run it with ```websaver run-script```

See examples in scripts/

